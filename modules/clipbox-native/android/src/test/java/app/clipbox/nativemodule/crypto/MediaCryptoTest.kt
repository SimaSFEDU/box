package app.clipbox.nativemodule.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.security.MessageDigest

class MediaCryptoTest {
  private val dek = VaultCrypto.randomBytes(32)

  private fun sample(n: Int) = ByteArray(n) { (it * 31 + it / 7).toByte() }

  @Test fun streamingRoundTripAcrossSegmentsWithHashAndSize() {
    val data = sample(MediaCrypto.SEGMENT * 2 + 12345)
    val out = ByteArrayOutputStream()
    val r = MediaCrypto.encrypt(dek, "m1", ByteArrayInputStream(data), out)
    assertEquals(data.size.toLong(), r.plaintextSize)
    assertEquals(MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }, r.sha256Hex)
    val ct = out.toByteArray()
    assertFalse(String(ct, Charsets.ISO_8859_1).contains(String(data.copyOfRange(1000, 1100), Charsets.ISO_8859_1)))
    assertArrayEquals(data, MediaCrypto.decryptingStream(dek, "m1", ByteArrayInputStream(ct)).readBytes())
  }

  @Test fun wrongIdOrKeyOrTamperingFails() {
    val out = ByteArrayOutputStream()
    MediaCrypto.encrypt(dek, "m1", ByteArrayInputStream(sample(5000)), out)
    val ct = out.toByteArray()
    assertThrows(Exception::class.java) { MediaCrypto.decryptingStream(dek, "m2", ByteArrayInputStream(ct)).readBytes() }
    assertThrows(Exception::class.java) { MediaCrypto.decryptingStream(VaultCrypto.randomBytes(32), "m1", ByteArrayInputStream(ct)).readBytes() }
    val bad = ct.copyOf().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { MediaCrypto.decryptingStream(dek, "m1", ByteArrayInputStream(bad)).readBytes() }
    val truncated = ct.copyOf(ct.size - 10)
    assertThrows(Exception::class.java) { MediaCrypto.decryptingStream(dek, "m1", ByteArrayInputStream(truncated)).readBytes() }
  }

  @Test fun seekableChannelSupportsRandomAccess() {
    val data = sample(MediaCrypto.SEGMENT * 3 + 77)
    val f = File.createTempFile("blob", ".bin").apply { deleteOnExit() }
    f.outputStream().use { MediaCrypto.encrypt(dek, "vid", ByteArrayInputStream(data), it) }
    Files.newByteChannel(f.toPath(), StandardOpenOption.READ).use { ch ->
      val plain = MediaCrypto.seekable(dek, "vid", ch)
      assertEquals(data.size.toLong(), plain.size())
      for (pos in listOf(0L, 5L, MediaCrypto.SEGMENT - 3L, 2L * MediaCrypto.SEGMENT + 100, data.size - 10L)) {
        val buf = ByteBuffer.allocate(10)
        plain.position(pos)
        plain.read(buf)
        assertArrayEquals(data.copyOfRange(pos.toInt(), pos.toInt() + 10), buf.array())
      }
    }
  }

  @Test fun sizeLimitAbortsImport() {
    assertThrows(IllegalArgumentException::class.java) {
      MediaCrypto.encrypt(dek, "x", ByteArrayInputStream(sample(2000)), ByteArrayOutputStream(), maxBytes = 1000)
    }
  }

  @Test fun thumbnailsBoundToId() {
    val t = MediaCrypto.sealThumb(dek, "a", byteArrayOf(1, 2, 3))
    assertArrayEquals(byteArrayOf(1, 2, 3), MediaCrypto.openThumb(dek, "a", t))
    assertThrows(VaultCrypto.AuthFailedException::class.java) { MediaCrypto.openThumb(dek, "b", t) }
  }

  @Test fun sniffsCommonFormatsAndIgnoresUntrustedMime() {
    assertEquals("image/jpeg", MediaCrypto.sniffMime(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0), "video/mp4"))
    assertEquals("image/gif", MediaCrypto.sniffMime("GIF89a".toByteArray(), null))
    assertEquals("image/webp", MediaCrypto.sniffMime("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ".toByteArray(Charsets.ISO_8859_1), null))
    assertEquals("video/mp4", MediaCrypto.sniffMime("\u0000\u0000\u0000\u0018ftypmp42".toByteArray(Charsets.ISO_8859_1), null))
    assertEquals("application/octet-stream", MediaCrypto.sniffMime(byteArrayOf(1, 2), "text/html\"><script"))
    assertEquals("application/zip", MediaCrypto.sniffMime(byteArrayOf(1, 2), "application/zip"))
  }
}
