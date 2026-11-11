package app.clipbox.nativemodule.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultSessionTest {
  @Test fun unlockCopiesAndWipesInputLockWipesKey() {
    val s = VaultSession()
    val dek = ByteArray(32) { 7 }
    s.unlock("vault", dek)
    assertTrue(dek.all { it == 0.toByte() })
    var held: ByteArray? = null
    s.withDek("vault") { held = it; assertArrayEquals(ByteArray(32) { 7 }, it) }
    s.lock("vault")
    assertTrue(held!!.all { it == 0.toByte() })
    assertThrows(VaultSession.LockedException::class.java) { s.withDek("vault") { } }
  }

  @Test fun modulesAreIndependent() {
    val s = VaultSession()
    s.unlock("vault", ByteArray(32) { 1 })
    s.unlock("media", ByteArray(32) { 2 })
    s.lock("media")
    assertTrue(s.isUnlocked("vault"))
    assertFalse(s.isUnlocked("media"))
    s.lockAll()
    assertEquals(emptySet<String>(), s.unlockedModules())
  }

  @Test fun idleTimeoutLocksAndUseRefreshesIt() {
    var now = 0L
    val s = VaultSession { now }
    s.setIdleTimeout("vault", 60_000)
    s.unlock("vault", ByteArray(32))
    now = 50_000
    s.withDek("vault") { }
    now = 100_000
    assertTrue(s.isUnlocked("vault"))
    now = 170_001
    assertFalse(s.isUnlocked("vault"))
  }
}
