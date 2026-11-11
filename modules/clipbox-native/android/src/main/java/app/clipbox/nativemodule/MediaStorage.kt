package app.clipbox.nativemodule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import app.clipbox.nativemodule.crypto.MediaCrypto
import app.clipbox.nativemodule.crypto.VaultCrypto
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.nio.file.Files
import java.nio.file.StandardOpenOption

/**
 * Encrypted on-disk store for Private Media (SECURITY_DESIGN §7).
 *   files/private/media/<random>.bin   streaming-AEAD ciphertext
 *   files/private/thumbs/<random>.bin  AEAD-encrypted JPEG thumbnail
 *   cache/share-out/<random>/<name>    short-lived plaintext copies for sharing only
 * Plaintext of stored media is never written to disk; thumbnails are generated in memory.
 */
class MediaStorage(private val context: Context) {
  companion object {
    const val MAX_IMPORT_BYTES = 4L * 1024 * 1024 * 1024
    const val THUMB_EDGE = 360
    const val SHARE_TTL_MS = 10 * 60 * 1000L
  }

  val mediaDir: File get() = File(context.filesDir, "private/media").apply { mkdirs(); File(this, ".nomedia").createNewFile() }
  val thumbDir: File get() = File(context.filesDir, "private/thumbs").apply { mkdirs() }
  val shareDir: File get() = File(context.cacheDir, "share-out").apply { mkdirs() }
  val backupDir: File get() = File(context.cacheDir, "backup-out").apply { mkdirs() }

  private fun randomName() = VaultCrypto.randomBytes(16).joinToString("") { "%02x".format(it) } + ".bin"

  fun blobFile(name: String): File = safeChild(mediaDir, name)
  fun thumbFile(name: String): File = safeChild(thumbDir, name)

  private fun safeChild(dir: File, name: String): File {
    require(name.matches(Regex("^[0-9a-f]{32}\\.bin$"))) { "invalid blob name" }
    return File(dir, name)
  }

  data class Imported(
    val blobName: String,
    val thumbName: String?,
    val size: Long,
    val mime: String,
    val sha256: String,
    val width: Int?,
    val height: Int?,
    val durationMs: Long?,
  )

  /** Streams [open]()'s content through encryption into a new blob, then builds an encrypted thumbnail. */
  fun import(dek: ByteArray, id: String, mimeHint: String?, open: () -> InputStream): Imported {
    val name = randomName()
    val tmp = File(mediaDir, "$name.tmp")
    val result = try {
      open().use { input -> tmp.outputStream().use { out -> MediaCrypto.encrypt(dek, id, input, out, MAX_IMPORT_BYTES) } }
    } catch (e: Throwable) {
      tmp.delete()
      throw e
    }
    val target = blobFile(name)
    if (!tmp.renameTo(target)) {
      tmp.delete()
      throw IllegalStateException("rename failed")
    }
    val mime = MediaCrypto.sniffMime(result.head, mimeHint)
    val info = try {
      describe(dek, id, target, mime)
    } catch (e: Throwable) {
      Visual(null, null, null, null) // undecodable content is still stored and shareable
    }
    val thumbName = info.thumb?.let { jpeg ->
      val n = randomName()
      File(thumbDir, n).writeBytes(MediaCrypto.sealThumb(dek, id, jpeg))
      n
    }
    return Imported(name, thumbName, result.plaintextSize, mime, result.sha256Hex, info.width, info.height, info.durationMs)
  }

  private data class Visual(val width: Int?, val height: Int?, val durationMs: Long?, val thumb: ByteArray?)

  private fun describe(dek: ByteArray, id: String, blob: File, mime: String): Visual = when {
    mime.startsWith("image/") -> describeImage(dek, id, blob)
    mime.startsWith("video/") -> describeVideo(dek, id, blob)
    else -> Visual(null, null, null, null)
  }

  private fun plain(dek: ByteArray, id: String, blob: File) = MediaCrypto.decryptingStream(dek, id, blob.inputStream().buffered())

  private fun describeImage(dek: ByteArray, id: String, blob: File): Visual {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    plain(dek, id, blob).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0) return Visual(null, null, null, null)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= THUMB_EDGE) sample *= 2
    val bmp = plain(dek, id, blob).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
      ?: return Visual(bounds.outWidth, bounds.outHeight, null, null)
    val rotation = try {
      plain(dek, id, blob).use { ExifInterface(it).rotationDegrees }
    } catch (e: Exception) {
      0
    }
    val (w, h) = if (rotation == 90 || rotation == 270) bounds.outHeight to bounds.outWidth else bounds.outWidth to bounds.outHeight
    return Visual(w, h, null, toThumb(bmp, rotation))
  }

  private fun describeVideo(dek: ByteArray, id: String, blob: File): Visual {
    val channel = MediaCrypto.seekable(dek, id, Files.newByteChannel(blob.toPath(), StandardOpenOption.READ))
    val mmr = MediaMetadataRetriever()
    try {
      mmr.setDataSource(ChannelDataSource(channel))
      val w = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
      val h = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
      val rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val dur = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
      val frame = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        mmr.getScaledFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, THUMB_EDGE, THUMB_EDGE)
      } else {
        mmr.getFrameAtTime(1_000_000)
      } ?: mmr.frameAtTime
      val (vw, vh) = if (rot == 90 || rot == 270) h to w else w to h
      return Visual(vw, vh, dur, frame?.let { toThumb(it, 0) })
    } finally {
      mmr.release()
      channel.close()
    }
  }

  private fun toThumb(src: Bitmap, rotation: Int): ByteArray {
    val scale = THUMB_EDGE.toFloat() / maxOf(src.width, src.height)
    val m = Matrix().apply {
      if (scale < 1f) postScale(scale, scale)
      if (rotation != 0) postRotate(rotation.toFloat())
    }
    val out = Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    return ByteArrayOutputStream().use { bos ->
      out.compress(Bitmap.CompressFormat.JPEG, 82, bos)
      if (out !== src) out.recycle()
      src.recycle()
      bos.toByteArray()
    }
  }

  fun readThumb(dek: ByteArray, id: String, name: String): ByteArray = MediaCrypto.openThumb(dek, id, thumbFile(name).readBytes())

  fun delete(blob: String?, thumb: String?) {
    blob?.let { blobFile(it).delete() }
    thumb?.let { thumbFile(it).delete() }
  }

  /** Decrypts to a fresh random directory under cache/share-out (plaintext; see SHARE_TTL_MS). */
  fun prepareShare(dek: ByteArray, id: String, blob: String, displayName: String): File {
    cleanupShares()
    val dir = File(shareDir, VaultCrypto.randomBytes(12).joinToString("") { "%02x".format(it) }).apply { mkdirs() }
    val out = File(dir, sanitize(displayName))
    plain(dek, id, blobFile(blob)).use { input -> out.outputStream().use { input.copyTo(it, 64 * 1024) } }
    return out
  }

  /** Removes share copies older than the TTL (or all with [all]); also stale backup files. */
  fun cleanupShares(all: Boolean = false) {
    val cutoff = System.currentTimeMillis() - SHARE_TTL_MS
    listOf(shareDir, backupDir).forEach { root ->
      root.listFiles()?.forEach { f -> if (all || f.lastModified() < cutoff) f.deleteRecursively() }
    }
  }

  fun sanitize(name: String): String {
    val n = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimStart('.')
    return n.take(120).ifEmpty { "file" }
  }

  fun plaintextChannel(dek: ByteArray, id: String, blob: String): SeekableByteChannel =
    MediaCrypto.seekable(dek, id, Files.newByteChannel(blobFile(blob).toPath(), StandardOpenOption.READ))

  /** MediaDataSource over a seekable plaintext channel (decrypts only the requested segments). */
  class ChannelDataSource(private val ch: SeekableByteChannel) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int = synchronized(ch) {
      if (position >= ch.size()) return -1
      ch.position(position)
      val bb = ByteBuffer.wrap(buffer, offset, size)
      var total = 0
      while (bb.hasRemaining()) {
        val n = ch.read(bb)
        if (n <= 0) break
        total += n
      }
      if (total == 0) -1 else total
    }

    override fun getSize(): Long = ch.size()
    override fun close() = ch.close()
  }

  fun uriForShare(file: File): Uri = Uri.Builder().scheme("content").authority(SecureMediaProvider.authority(context))
    .appendPath("s").appendPath(file.parentFile!!.name).appendPath(file.name).build()
}
