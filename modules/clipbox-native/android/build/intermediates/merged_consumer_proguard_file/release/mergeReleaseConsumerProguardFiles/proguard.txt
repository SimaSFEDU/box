# Tink and Bouncy Castle are used via reflection-free APIs, but keep Argon2 classes intact.
-keep class org.bouncycastle.crypto.generators.Argon2BytesGenerator { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters** { *; }
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
# Strip debug/verbose/info logs in release (SECURITY_DESIGN §11).
-assumenosideeffects class android.util.Log { public static int d(...); public static int v(...); public static int i(...); }
