package app.clipbox.nativemodule.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class BackupFormatTest {
  private fun build(password: String, records: List<Triple<Int, String, ByteArray>>): ByteArray {
    val out = ByteArrayOutputStream()
    BackupFormat.Writer(out, password.toCharArray(), 42L, mapOf("vault" to 1, "media" to 1)).use { w ->
      records.forEach { (t, n, b) -> w.record(t, n, b) }
    }
    return out.toByteArray()
  }

  private fun read(bytes: ByteArray, password: String): List<Triple<Int, String, ByteArray>> {
    val got = mutableListOf<Triple<Int, String, ByteArray>>()
    BackupFormat.read(ByteArrayInputStream(bytes), password.toCharArray()) { t, n, _, content -> got += Triple(t, n, content.readBytes()) }
    return got
  }

  private val records = listOf(
    Triple(BackupFormat.TYPE_VAULT_ENTRY, "e1", """{"title":"GitHub","password":"hunter2"}""".toByteArray()),
    Triple(BackupFormat.TYPE_MEDIA_META, "m1", """{"name":"cat.jpg"}""".toByteArray()),
    Triple(BackupFormat.TYPE_MEDIA_BLOB, "m1", ByteArray(3 * MediaCrypto.SEGMENT / 2) { it.toByte() }),
  )

  @Test fun roundTripPreservesRecordsAndHidesContent() {
    val bytes = build("backup pass phrase", records)
    val back = read(bytes, "backup pass phrase")
    assertEquals(records.size, back.size)
    records.zip(back).forEach { (a, b) ->
      assertEquals(a.first, b.first); assertEquals(a.second, b.second); assertArrayEquals(a.third, b.third)
    }
    assertTrue(!String(bytes, Charsets.ISO_8859_1).contains("hunter2"))
    assertTrue(String(bytes.copyOfRange(0, 8), Charsets.US_ASCII) == "CBVAULT1")
  }

  @Test fun wrongPasswordTamperingAndTruncationAreRejected() {
    val bytes = build("backup pass phrase", records)
    assertThrows(VaultCrypto.AuthFailedException::class.java) { read(bytes, "wrong password!!") }
    val tampered = bytes.copyOf().also { it[it.size - 100] = (it[it.size - 100].toInt() xor 1).toByte() }
    assertThrows(VaultCrypto.AuthFailedException::class.java) { read(tampered, "backup pass phrase") }
    val truncated = bytes.copyOf(bytes.size - MediaCrypto.SEGMENT / 2)
    assertThrows(VaultCrypto.AuthFailedException::class.java) { read(truncated, "backup pass phrase") }
    // Header is authenticated too: editing it breaks decryption.
    val hdr = bytes.copyOf().also { it[20] = (it[20].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { read(hdr, "backup pass phrase") }
  }

  @Test fun rejectsForeignFiles() {
    assertThrows(BackupFormat.FormatException::class.java) { read("PK\u0003\u0004 not a backup".toByteArray(), "x") }
  }

  @Test fun unreadRecordsAreSkippedCorrectly() {
    val bytes = build("pw-pw-pw-pw", records)
    val names = mutableListOf<String>()
    BackupFormat.read(ByteArrayInputStream(bytes), "pw-pw-pw-pw".toCharArray()) { _, n, _, _ -> names += n }
    assertEquals(listOf("e1", "m1", "m1"), names)
  }
}
