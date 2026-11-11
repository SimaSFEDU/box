package app.clipbox.nativemodule

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.OsConstants
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileNotFoundException
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.security.MessageDigest

/**
 * Serves Private Media without writing plaintext to disk:
 *   /m/<id>/<blob>?t=<token>   decrypted on the fly via ProxyFileDescriptor (seekable; video-friendly)
 *   /t/<id>/<thumb>?t=<token>  decrypted thumbnail via pipe
 *   /s/<dir>/<name>            short-lived share copy (the only path ever granted to other apps)
 * Not exported. /m and /t require the media module to be unlocked and the current token.
 */
class SecureMediaProvider : ContentProvider() {
  companion object {
    fun authority(context: Context) = "${context.packageName}.securemedia"
  }

  private lateinit var io: Handler
  private val storage by lazy { MediaStorage(context!!) }

  override fun onCreate(): Boolean {
    io = Handler(HandlerThread("clipbox-media-io").apply { start() }.looper)
    return true
  }

  private fun checkToken(uri: Uri) {
    val t = uri.getQueryParameter("t") ?: throw FileNotFoundException()
    if (!MessageDigest.isEqual(t.toByteArray(), Protected.mediaToken.toByteArray())) throw FileNotFoundException()
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("read-only")
    val seg = uri.pathSegments
    return when (seg.firstOrNull()) {
      "m" -> {
        if (seg.size != 3) throw FileNotFoundException()
        checkToken(uri)
        openMedia(seg[1], seg[2])
      }
      "t" -> {
        if (seg.size != 3) throw FileNotFoundException()
        checkToken(uri)
        val bytes = try {
          Protected.session.withDek("media") { dek -> storage.readThumb(dek, seg[1], seg[2]) }
        } catch (e: Exception) {
          throw FileNotFoundException()
        }
        pipe(bytes)
      }
      "s" -> ParcelFileDescriptor.open(shareFile(uri), ParcelFileDescriptor.MODE_READ_ONLY)
      else -> throw FileNotFoundException()
    }
  }

  private fun shareFile(uri: Uri): File {
    val seg = uri.pathSegments
    if (seg.size != 3) throw FileNotFoundException()
    val f = File(File(storage.shareDir, seg[1]), seg[2]).canonicalFile
    if (!f.path.startsWith(storage.shareDir.canonicalPath + File.separator) || !f.isFile) throw FileNotFoundException()
    return f
  }

  private fun openMedia(id: String, blob: String): ParcelFileDescriptor {
    val channel = try {
      Protected.session.withDek("media") { dek -> storage.plaintextChannel(dek, id, blob) }
    } catch (e: Exception) {
      throw FileNotFoundException()
    }
    val sm = context!!.getSystemService(StorageManager::class.java)
    return sm.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, ChannelCallback(channel), io)
  }

  private class ChannelCallback(private val ch: SeekableByteChannel) : ProxyFileDescriptorCallback() {
    override fun onGetSize(): Long = ch.size()

    override fun onRead(offset: Long, size: Int, data: ByteArray): Int {
      // Reading also requires the module to still be unlocked (lock wipes the key; stop serving).
      if (!Protected.session.isUnlocked("media")) throw ErrnoException("onRead", OsConstants.EACCES)
      try {
        if (offset >= ch.size()) return 0
        ch.position(offset)
        val bb = ByteBuffer.wrap(data, 0, size)
        var total = 0
        while (bb.hasRemaining()) {
          val n = ch.read(bb)
          if (n <= 0) break
          total += n
        }
        return total
      } catch (e: Exception) {
        throw ErrnoException("onRead", OsConstants.EIO)
      }
    }

    override fun onRelease() {
      runCatching { ch.close() }
    }
  }

  private fun pipe(bytes: ByteArray): ParcelFileDescriptor {
    val (read, write) = ParcelFileDescriptor.createReliablePipe()
    io.post {
      ParcelFileDescriptor.AutoCloseOutputStream(write).use { runCatching { it.write(bytes) } }
      bytes.fill(0)
    }
    return read
  }

  override fun getType(uri: Uri): String? {
    val name = uri.lastPathSegment ?: return null
    if (uri.pathSegments.firstOrNull() == "t") return "image/jpeg"
    val ext = name.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
    if (uri.pathSegments.firstOrNull() != "s") return null
    val f = shareFile(uri)
    val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return MatrixCursor(cols, 1).apply {
      addRow(cols.map { c -> when (c) { OpenableColumns.DISPLAY_NAME -> f.name; OpenableColumns.SIZE -> f.length(); else -> null } })
    }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
