import { execFile } from "node:child_process";
import { promisify } from "node:util";

// X11 隔离桌面使用真实 OS 指针，跨窗拖放不能用只在单个 document 派发的合成事件代替。
export async function nativeSidePaneDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await promisify(execFile)("python3", [
    "-c",
    `
import ctypes, json, sys, time
p=json.loads(sys.argv[1]); q=json.loads(sys.argv[2])
x=ctypes.CDLL('libX11.so.6'); t=ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype=ctypes.c_void_p
x.XFlush.argtypes=[ctypes.c_void_p]
x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('X11 display unavailable')
t.XTestFakeMotionEvent(d,0,p['x'],p['y'],0); x.XFlush(d); time.sleep(.1)
t.XTestFakeButtonEvent(d,1,1,0); x.XFlush(d); time.sleep(.1)
for i in range(1,31):
 t.XTestFakeMotionEvent(d,0,round(p['x']+(q['x']-p['x'])*i/30),round(p['y']+(q['y']-p['y'])*i/30),0)
 x.XFlush(d); time.sleep(.035)
time.sleep(.6); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
`,
    JSON.stringify(start),
    JSON.stringify(end),
  ]);
}
