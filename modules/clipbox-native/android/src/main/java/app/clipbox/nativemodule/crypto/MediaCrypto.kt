package app.clipbox.nativemodule.crypto

import com.google.crypto.tink.subtle.AesGcmHkdfStreaming
import com.google.crypto.tink.subtle.AesGcmJce
import java.io.InputStream
import java.io.OutputStream
import java.nio.channels.SeekableByteChannel
import java.security.DigestInputStream
import java.security.GeneralSecurityException
import java.security.MessageDigest

/**
 * Streaming file encryption for Private Media (SECURITY_DESIGN §5, §7):
 * Tink AES-256-GCM-HKDF streaming AEAD, 1 MiB segments — constant memory, random-access
 * decryption (video seeking), truncation and reordering detected. AD binds a blob to its id.
 */
object MediaCrypto {
  const val SEGMENT = 1 shl 20
  private const val BUFFER = 64 * 1024

  fun streaming(dek: ByteArray): AesGcmHkdfStreaming = AesGcmHkdfStreaming(dek, "HmacSha256", 32, SEGMENT, 0)

  private fun ad(id: String) = "clipbox/media/v1/$id".toByteArray(Charsets.UTF_8)
  private fun thumbAd(id: String) = "clipbox/thumb/v1/$id".toByteArray(Charsets.UTF_8)

  data class EncryptResult(val plaintextSize: Long, val sha256Hex: String, val head: ByteArray)

  /**
   * Encrypts [input] into [output] in one pass, returning plaintext size, SHA-256 and the first
   * bytes (for type sniffing). [maxBytes] aborts oversized imports. Closes [output], not [input].
   */
  fun encrypt(dek: ByteArray, id: String, input: InputStream, output: OutputStream, maxBytes: Long = Long.MAX_VALUE): EncryptResult {
    val md = MessageDigest.getInstance("SHA-256")
    val head = java.io.ByteArrayOutputStream()
    var total = 0L
    streaming(dek).newEncryptingStream(output, ad(id)).use { enc ->
      val din = DigestInputStream(input, md)
      val buf = ByteArray(BUFFER)
      while (true) {
        val n = din.read(buf)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw IllegalArgumentException("file too large")
        if (head.size() < 64) head.write(buf, 0, minOf(n, 64 - head.size()))
        enc.write(buf, 0, n)
      }
    }
    return EncryptResult(total, md.digest().joinToString("") { "%02x".format(it) }, head.toByteArray())
  }

  fun decryptingStream(dek: ByteArray, id: String, ciphertext: InputStream): InputStream =
    streaming(dek).newDecryptingStream(ciphertext, ad(id))

  /** Random-access plaintext view (used by the content provider for seeking). */
  fun seekable(dek: ByteArray, id: String, ciphertext: SeekableByteChannel): SeekableByteChannel = try {
    streaming(dek).newSeekableDecryptingChannel(ciphertext, ad(id))
  } catch (e: GeneralSecurityException) {
    throw VaultCrypto.AuthFailedException("media header authentication failed")
  }

  fun sealThumb(dek: ByteArray, id: String, jpeg: ByteArray): ByteArray = AesGcmJce(dek).encrypt(jpeg, thumbAd(id))

  fun openThumb(dek: ByteArray, id: String, blob: ByteArray): ByteArray = try {
    AesGcmJce(dek).decrypt(blob, thumbAd(id))
  } catch (e: GeneralSecurityException) {
    throw VaultCrypto.AuthFailedException("thumbnail authentication failed")
  }

  /** Magic-number sniffing; the sender-provided MIME type is not trusted for rendering decisions. */
  fun sniffMime(head: ByteArray, fallback: String?): String {
    fun at(i: Int, vararg b: Int) = head.size >= i + b.size && b.indices.all { head[i + it].toInt() and 0xff == b[it] }
    fun ascii(i: Int, s: String) = head.size >= i + s.length && s.indices.all { head[i + it].toInt().toChar() == s[it] }
    return when {
      at(0, 0xFF, 0xD8, 0xFF) -> "image/jpeg"
      at(0, 0x89, 0x50, 0x4E, 0x47) -> "image/png"
      ascii(0, "GIF8") -> "image/gif"
      ascii(0, "RIFF") && ascii(8, "WEBP") -> "image/webp"
      ascii(4, "ftyp") && (ascii(8, "heic") || ascii(8, "heix") || ascii(8, "mif1")) -> "image/heic"
      ascii(4, "ftyp") && ascii(8, "qt  ") -> "video/quicktime"
      ascii(4, "ftyp") -> "video/mp4"
      at(0, 0x1A, 0x45, 0xDF, 0xA3) -> "video/webm"
      ascii(0, "%PDF") -> "application/pdf"
      else -> fallback?.takeIf { it.matches(Regex("^[a-z]+/[a-z0-9.+-]+$")) } ?: "application/octet-stream"
    }
  }
}
