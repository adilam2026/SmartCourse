package app.smartcourse.courses.nativeproto

/** Centimes → « 12,50 » (même écriture que « %d,%02d »). Commun à Android et à l'iPhone. */
fun centsText(cents: Long): String = "${cents / 100},${(cents % 100).toString().padStart(2, '0')}"
