package app.clipbox.nativemodule.crypto

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.security.GeneralSecurityException

/**
 * Encrypted backup of protected modules (`.cbvault`, SECURITY_DESIGN §9).
 *
 *   "CBVAULT1" | u32 headerLen | header JSON (kdf params, created, counts)   — plaintext, authenticated as AD
 *   Tink streaming AEAD( KEK = Argon2id(backup password), AD = magic|header ) of:
 *     repeated records: u8 type | u16 nameLen | name(UTF-8) | u64 dataLen | data
 *     terminator: u8 0
 *
 * The backup password is independent from the master password. Device DEKs never leave the
 * device: records are plaintext inside the backup stream and get re-encrypted on restore.
 * Streaming AEAD authenticates every segment and the final one, so tampering or truncation is
 * detected; restore performs a full verification pass before writing anything.
 */
object BackupFormat {
  val MAGIC = "CBVAULT1".toByteArray(Charsets.US_ASCII)
  const val TYPE_END: Int = 0
  const val TYPE_VAULT_ENTRY: Int = 1
  const val TYPE_MEDIA_META: Int = 2
  const val TYPE_MEDIA_BLOB: Int = 3
  const val TYPE_MEDIA_COLLECTION: Int = 4
  private const val MAX_NAME = 1024

  class FormatException(msg: String) : Exception(msg)

  /** Argon2 for backups: memory-hard but bounded for phones; independent salt per backup. */
  fun newKdfParams(): VaultCrypto.KdfParams = VaultCrypto.KdfParams(128 * 1024, 4, 1, VaultCrypto.newSalt())

  class Writer(out: OutputStream, password: CharArray, createdAt: Long, counts: Map<String, Int>) : AutoCloseable {
    private val data: DataOutputStream

    init {
      val params = newKdfParams()
      val header = """{"v":1,"createdAt":$createdAt,"kdf":${params.toJson()},"counts":{${counts.entries.joinToString(",") { "\"${it.key}\":${it.value}" }}}}"""
        .toByteArray(Charsets.UTF_8)
      val raw = DataOutputStream(out)
      raw.write(MAGIC)
      raw.writeInt(header.size)
      raw.write(header)
      raw.flush()
      val kek = VaultCrypto.argon2id(password, params)
      try {
        data = DataOutputStream(MediaCrypto.streaming(kek).newEncryptingStream(out, MAGIC + header).buffered(1 shl 16))
      } finally {
        kek.fill(0)
      }
    }

    fun record(type: Int, name: String, bytes: ByteArray) = record(type, name, bytes.size.toLong(), bytes.inputStream())

    fun record(type: Int, name: String, length: Long, content: InputStream) {
      require(type in 1..255)
      val n = name.toByteArray(Charsets.UTF_8)
      require(n.size <= MAX_NAME)
      data.writeByte(type)
      data.writeShort(n.size)
      data.write(n)
      data.writeLong(length)
      val buf = ByteArray(64 * 1024)
      var left = length
      while (left > 0) {
        val r = content.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
        if (r < 0) throw EOFException("source shorter than declared length")
        data.write(buf, 0, r)
        left -= r
      }
    }

    override fun close() {
      data.writeByte(TYPE_END)
      data.close()
    }
  }

  data class Header(val json: String, val kdf: VaultCrypto.KdfParams)

  fun readHeader(input: DataInputStream): Pair<Header, ByteArray> {
    val magic = ByteArray(MAGIC.size)
    input.readFully(magic)
    if (!magic.contentEquals(MAGIC)) throw FormatException("not a Clipbox backup")
    val len = input.readInt()
    if (len !in 2..65536) throw FormatException("bad header")
    val header = ByteArray(len).also { input.readFully(it) }
    val json = String(header, Charsets.UTF_8)
    val kdfJson = Regex("\"kdf\"\\s*:\\s*(\\{[^}]*\\})").find(json)?.groupValues?.get(1) ?: throw FormatException("bad header")
    return Header(json, VaultCrypto.KdfParams.fromJson(kdfJson)) to header
  }

  /**
   * Reads all records, calling [onRecord] for each (the stream must be fully consumed by the callback
   * or it is skipped). Throws AuthFailedException on wrong password / tampering / truncation.
   */
  fun read(input: InputStream, password: CharArray, onRecord: (type: Int, name: String, length: Long, content: InputStream) -> Unit): Header {
    val din = DataInputStream(input)
    val (header, headerBytes) = readHeader(din)
    val kek = VaultCrypto.argon2id(password, header.kdf)
    val plain = try {
      DataInputStream(MediaCrypto.streaming(kek).newDecryptingStream(din, MAGIC + headerBytes).buffered(1 shl 16))
    } finally {
      kek.fill(0)
    }
    try {
      while (true) {
        val type = plain.readUnsignedByte()
        if (type == TYPE_END) {
          if (plain.read() != -1) throw FormatException("trailing data")
          return header
        }
        val nameLen = plain.readUnsignedShort()
        if (nameLen > MAX_NAME) throw FormatException("bad record")
        val name = String(ByteArray(nameLen).also { plain.readFully(it) }, Charsets.UTF_8)
        val length = plain.readLong()
        if (length < 0) throw FormatException("bad record")
        val limited = BoundedInput(plain, length)
        onRecord(type, name, length, limited)
        limited.drain()
      }
    } catch (e: java.io.IOException) {
      // Tink reports authentication failures from inside the stream as IOException.
      if (e is EOFException || e.cause is GeneralSecurityException || e.message?.contains("ecrypt", true) == true || e.message?.contains("tag", true) == true) {
        throw VaultCrypto.AuthFailedException("backup authentication failed")
      }
      throw e
    }
  }

  private class BoundedInput(private val src: InputStream, private var left: Long) : InputStream() {
    override fun read(): Int = if (left <= 0) -1 else src.read().also { if (it >= 0) left-- else throw EOFException() }
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (left <= 0) return -1
      val n = src.read(b, off, minOf(len.toLong(), left).toInt())
      if (n < 0) throw EOFException()
      left -= n
      return n
    }
    fun drain() {
      val buf = ByteArray(8192)
      while (read(buf, 0, buf.size) >= 0) Unit
    }
  }
}
