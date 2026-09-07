# kotlinx.serialization genera serializadores por reflexión sobre los nombres de clase.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class org.cosasvarias.manoslibres.net.** {
    *** Companion;
}
-keepclasseswithmembers class org.cosasvarias.manoslibres.net.** {
    kotlinx.serialization.KSerializer serializer(...);
}
