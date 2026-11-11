// Runs the pure-JVM crypto core tests without the Android SDK:
//   cd modules/clipbox-native/jvm-tests && gradle test
// The same sources and tests also run inside the Android module (testDebugUnitTest) in CI.
plugins {
  kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

// Uses whatever JDK runs Gradle (17+); no toolchain download needed.
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }

sourceSets {
  main { kotlin.srcDir("../android/src/main/java/app/clipbox/nativemodule/crypto") }
  test { kotlin.srcDir("../android/src/test/java/app/clipbox/nativemodule/crypto") }
}

dependencies {
  implementation("com.google.crypto.tink:tink:1.24.0")
  implementation("org.bouncycastle:bcprov-jdk18on:1.87")
  testImplementation("junit:junit:4.13.2")
}

tasks.test { testLogging { events("passed", "failed"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL } }
