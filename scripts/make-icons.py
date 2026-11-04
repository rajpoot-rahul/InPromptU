"""Generate the app's original vector-style mark as PNG/ICO/ICNS; no dependencies."""
from pathlib import Path
import struct
import zlib
import math

out = Path(__file__).resolve().parent.parent / 'src' / 'assets'
out.mkdir(parents=True, exist_ok=True)

def png(size, tray=False):
    data = bytearray()
    for y in range(size):
        data.append(0)
        for x in range(size):
            px, py = (x + .5) / size * 64, (y + .5) / size * 64
            dx, dy = px - 32, py - 32
            radius = math.hypot(dx, dy)
            angle = math.atan2(dy, dx)
            distance = abs(math.sin(angle - round(angle / (math.pi / 4)) * math.pi / 4) * radius)
            mark = radius < 19 and distance < 3 and radius > 6
            rounded = math.hypot(max(abs(dx) - 14, 0), max(abs(dy) - 14, 0)) <= 18
            color = (28, 42, 30, 255) if mark and tray else (215, 232, 216, 255) if mark else (53, 95, 78, 255)
            if (tray and not mark) or (not tray and not rounded):
                color = (0, 0, 0, 0)
            data.extend(color)
    def chunk(name, payload):
        return struct.pack('>I', len(payload)) + name + payload + struct.pack('>I', zlib.crc32(name + payload) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(data))) + chunk(b'IEND', b'')

images = {size: png(size) for size in [128, 256, 512, 1024]}
(out / 'icon.png').write_bytes(images[512])
(out / 'tray.png').write_bytes(png(64, True))
blocks = b''.join(kind + struct.pack('>I', len(images[size]) + 8) + images[size] for kind, size in [(b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024)])
(out / 'icon.icns').write_bytes(b'icns' + struct.pack('>I', len(blocks) + 8) + blocks)
image = images[256]
(out / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(image), 22) + image)
print('Created app icons for macOS and Windows.')
