#!/usr/bin/env python3
"""Gera os ícones das três plataformas a partir do SVG original."""
from pathlib import Path
from io import BytesIO
import cairosvg
from PIL import Image

root=Path(__file__).resolve().parents[1]
svg=(root/'.seven/assets/seven-code.svg').read_bytes()
def raster(n):
    return Image.open(BytesIO(cairosvg.svg2png(bytestring=svg,output_width=n,output_height=n))).convert('RGBA')

sizes={'resources/linux/code.png':512,'resources/linux/seven-code.png':512,
 'resources/win32/code_150x150.png':150,'resources/win32/code_70x70.png':70,
 'resources/win32/code_44x44.png':44,'resources/server/favicon.png':192}
for name,size in sizes.items():
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);raster(size).save(file,'PNG')
ico=root/'resources/win32/code.ico';ico.parent.mkdir(parents=True,exist_ok=True)
raster(256).save(ico,'ICO',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
icns=root/'resources/darwin/code.icns';icns.parent.mkdir(parents=True,exist_ok=True)
raster(1024).save(icns,'ICNS')
print('Seven Code: PNG, ICO e ICNS gerados.')
