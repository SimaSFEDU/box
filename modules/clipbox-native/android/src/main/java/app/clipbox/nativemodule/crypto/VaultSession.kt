package app.clipbox.nativemodule.crypto

/**
 * In-memory holder of unlocked data-encryption keys, one per protected module.
 * DEKs never leave native code. `lock` overwrites key bytes before dropping them
 * (JVM may still hold transient copies; we minimise lifetime — SECURITY_DESIGN §4).
 */
class VaultSession(private val clock: () -> Long = System::currentTimeMillis) {
  class LockedException(module: String) : IllegalStateException("module $module is locked")

  private data class Entry(val dek: ByteArray, var lastUse: Long)

  private val keys = HashMap<String, Entry>()
  private val idleTimeoutMs = HashMap<String, Long>()

  @Synchronized
  fun unlock(module: String, dek: ByteArray) {
    keys.remove(module)?.dek?.fill(0)
    keys[module] = Entry(dek.copyOf(), clock())
    dek.fill(0)
  }

  @Synchronized
  fun isUnlocked(module: String): Boolean {
    expireIdle()
    return keys.containsKey(module)
  }

  /** Runs [block] with the module DEK; refreshes the idle timer. */
  @Synchronized
  fun <T> withDek(module: String, block: (ByteArray) -> T): T {
    expireIdle()
    val e = keys[module] ?: throw LockedException(module)
    e.lastUse = clock()
    return block(e.dek)
  }

  @Synchronized
  fun touch(module: String) {
    expireIdle()
    keys[module]?.lastUse = clock()
  }

  @Synchronized
  fun setIdleTimeout(module: String, ms: Long) {
    idleTimeoutMs[module] = ms
  }

  @Synchronized
  fun lock(module: String) {
    keys.remove(module)?.dek?.fill(0)
  }

  @Synchronized
  fun lockAll() {
    keys.values.forEach { it.dek.fill(0) }
    keys.clear()
  }

  @Synchronized
  fun unlockedModules(): Set<String> {
    expireIdle()
    return keys.keys.toSet()
  }

  private fun expireIdle() {
    val now = clock()
    val expired = keys.filter { (m, e) -> idleTimeoutMs[m]?.let { it > 0 && now - e.lastUse > it } == true }.keys
    expired.forEach { lock(it) }
  }
}
