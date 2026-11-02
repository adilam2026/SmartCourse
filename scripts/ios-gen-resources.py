#!/usr/bin/env python3
"""Vérifie que ios/shared/.../ResourcesIos.kt couvre exactement les images de l'application Android (sortie 1 sinon)."""
import os, re, sys
root = os.path.join(os.path.dirname(__file__), '..')
names = sorted(os.path.splitext(f)[0] for f in os.listdir(os.path.join(root, 'android-native/app/src/main/res/drawable-nodpi')))
src = open(os.path.join(root, 'ios/shared/src/iosMain/kotlin/app/smartcourse/courses/nativeproto/ResourcesIos.kt')).read()
have = sorted(re.findall(r'const val (\w+) =', src))
if have != names:
    print('Images Android et iPhone différentes :', sorted(set(names) ^ set(have)))
    sys.exit(1)
print(f'Images communes : {len(names)}')
