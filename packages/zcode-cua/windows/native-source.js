// 固定源码随 bundle 分发；模型文字只进入 JSON stdin，不能成为 PowerShell/C# 代码。
export const nativeSource = String.raw`
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Automation.Text;

public static class ZCodeOpenAutomation {
  class Failure : Exception { public string Code; public Failure(string code, string message) : base(message) { Code = code; } }
  class Snapshot { public IntPtr Window; public int Pid; public Rect Bounds; public string Frame; public Dictionary<int, AutomationElement> Elements = new Dictionary<int, AutomationElement>(); }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; public int Width { get { return Right-Left; } } public int Height { get { return Bottom-Top; } } }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputData { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputData data; }
  delegate bool EnumWindowsProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder title,int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flag);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 12*1024*1024, RecursionLimit = 40 };
  static readonly Dictionary<string,Snapshot> States = new Dictionary<string,Snapshot>();
  static Mutex Controller;
  static volatile string Owner;
  static readonly HashSet<string> Stopped = new HashSet<string>();
  static bool Sent;
  static volatile bool Killed;
  static volatile bool Running;
  static volatile bool Injecting;
  static volatile bool Cancelled;
  public static void Initialize() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    Controller = new Mutex(false, @"Local\ZCode.OpenComputerUse.Controller.v1");
    Running = true;
    var watcher = new Thread(() => { while(Running) { if(Owner != null && !Injecting && (GetAsyncKeyState(27)&0x8000)!=0) Killed=true; Thread.Sleep(20); } });
    watcher.IsBackground=true; watcher.Start();
  }
  public static void Shutdown() { Running=false; Release(Owner); if(Controller!=null) Controller.Dispose(); }
  public static void Run() {
    using(var lines=new BlockingCollection<string>()) {
      var reader=new Thread(() => { try { string line; while((line=Console.ReadLine())!=null){if(line=="{\"cancel\":true}"){Cancelled=true;Killed=true;}else lines.Add(line);} } finally { Cancelled=true;Killed=true;lines.CompleteAdding(); } });
      reader.IsBackground=true;reader.Start();
      while(!lines.IsCompleted) {
        // Mutex 必须由持锁线程释放；空闲轮询处理物理 Esc，不能等模型下一次调用才交还控制。
        if(Killed&&Owner!=null){Stopped.Add(Owner);Release(Owner);}
        string line;if(lines.TryTake(out line,20))Console.WriteLine(Handle(line));
      }
    }
  }
  static Dictionary<string,object> D(params object[] pairs) { var d=new Dictionary<string,object>(); for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1]; return d; }
  static Dictionary<string,object> Obj(object value) { return value as Dictionary<string,object> ?? new Dictionary<string,object>(); }
  static object V(Dictionary<string,object> d,string k,object fallback=null){object v;return d.TryGetValue(k,out v)?v:fallback;}
  static string S(Dictionary<string,object> d,string k,string fallback=""){return Convert.ToString(V(d,k,fallback));}
  static int I(Dictionary<string,object> d,string k,int fallback=0){return Convert.ToInt32(V(d,k,fallback));}
  static bool B(Dictionary<string,object> d,string k){return object.Equals(V(d,k),true);}
  static void Fail(string code,string message){throw new Failure(code,message);}
  static void CheckDesktop(){var h=OpenInputDesktop(0,false,0x0100);if(h==IntPtr.Zero)Fail("SCREEN_LOCKED","Unlock the interactive Windows desktop");CloseDesktop(h);}
  static int Pid(IntPtr w){uint p;GetWindowThreadProcessId(w,out p);return (int)p;}
  static string Title(IntPtr w){var s=new StringBuilder(1024);GetWindowText(w,s,s.Capacity);return s.ToString();}
  static string Name(int pid){try{return Process.GetProcessById(pid).ProcessName;}catch{return "";}}
  static List<IntPtr> Windows(){var result=new List<IntPtr>();EnumWindows((w,p)=>{if(IsWindowVisible(w)&&Title(w).Length>0)result.Add(w);return true;},IntPtr.Zero);return result;}
  static Dictionary<string,object> App(IntPtr w){int pid=Pid(w);return D("pid",pid,"name",Name(pid),"bundle_id",null,"active",GetForegroundWindow()==w);}
  static object WindowInfo(IntPtr w){Rect r;GetWindowRect(w,out r);return D("window_id",w.ToInt64(),"title",Title(w),"pid",Pid(w),"bounds",D("x",r.Left,"y",r.Top,"width",r.Width,"height",r.Height));}
  static List<IntPtr> Matches(Dictionary<string,object> app){
    var windows=Windows();
    if(app.ContainsKey("pid"))windows=windows.Where(w=>Pid(w)==I(app,"pid")).ToList();
    else windows=windows.Where(w=>String.Equals(Name(Pid(w)),S(app,"name"),StringComparison.OrdinalIgnoreCase)).ToList();
    if(app.ContainsKey("window_id"))windows=windows.Where(w=>w.ToInt64()==Convert.ToInt64(app["window_id"])).ToList();
    return windows;
  }
  static IntPtr Resolve(Dictionary<string,object> app){
    var windows=Matches(app);
    if(windows.Count==0)Fail("APP_NOT_FOUND","No running app/window matches. Open the app, then listApps().");
    if(windows.Select(Pid).Distinct().Count()>1)Fail("AMBIGUOUS_APP","More than one process matches; use an observed pid and window_id");
    var foreground=GetForegroundWindow();if(windows.Contains(foreground))return foreground;
    if(windows.Count!=1)Fail("AMBIGUOUS_APP","More than one window matches; select an observed window_id");
    return windows[0];
  }
  static string StateKey(string owner,IntPtr window){return owner+"/"+window.ToInt64();}
  static string Kind(AutomationElement element){return element.Current.ControlType.ProgrammaticName.Replace("ControlType.","");}
  static string Value(AutomationElement e){
    if(e.Current.IsPassword)return null;
    object pattern;
    if(e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))return ((ValuePattern)pattern).Current.Value;
    if(e.TryGetCurrentPattern(TextPattern.Pattern,out pattern))return ((TextPattern)pattern).DocumentRange.GetText(8192);
    return null;
  }
  static List<string> Actions(AutomationElement e){
    var result=new List<string>();object p;
    if(e.TryGetCurrentPattern(InvokePattern.Pattern,out p))result.Add("Invoke");
    if(e.TryGetCurrentPattern(TogglePattern.Pattern,out p))result.Add("Toggle");
    if(e.TryGetCurrentPattern(SelectionItemPattern.Pattern,out p))result.Add("Select");
    if(e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out p)){result.Add("Expand");result.Add("Collapse");}
    if(e.Current.IsKeyboardFocusable)result.Add("Focus");return result;
  }
  static object Observe(Dictionary<string,object> args,string owner){
    IntPtr w=Resolve(Obj(V(args,"app_ref")));Rect rect;GetWindowRect(w,out rect);
    var state=new Snapshot {Window=w,Pid=Pid(w),Bounds=rect};
    var rows=new List<object>();var text=new StringBuilder();text.AppendLine(Title(w));
    var queue=new Queue<KeyValuePair<AutomationElement,int>>();queue.Enqueue(new KeyValuePair<AutomationElement,int>(AutomationElement.FromHandle(w),0));
    while(queue.Count>0&&rows.Count<500){
      var item=queue.Dequeue();var e=item.Key;int depth=item.Value;
      try {
        int index=rows.Count;string kind=Kind(e);string title=e.Current.Name;string value=Value(e);var actions=Actions(e);object p;
        bool settable=e.TryGetCurrentPattern(ValuePattern.Pattern,out p)&&!((ValuePattern)p).Current.IsReadOnly&&!e.Current.IsPassword;
        state.Elements[index]=e;
        rows.Add(D("index",index,"kind",kind,"title",title,"value",value,"actions",actions,"settable",settable,"focused",e.Current.HasKeyboardFocus));
        text.Append(' ',Math.Min(depth,12)*2).Append(index).Append(" ").Append(kind).Append(" ").Append(Json.Serialize(title));
        if(value!=null)text.Append(" value=").Append(Json.Serialize(value.Length>2048?value.Substring(0,2048):value));
        if(actions.Count>0)text.Append(" actions=").Append(String.Join(",",actions));if(settable)text.Append(" settable");text.AppendLine();
        if(depth<12){var c=TreeWalker.ControlViewWalker.GetFirstChild(e);int children=0;while(c!=null&&children++<500&&queue.Count<1000){queue.Enqueue(new KeyValuePair<AutomationElement,int>(c,depth+1));c=TreeWalker.ControlViewWalker.GetNextSibling(c);}}
      }catch(ElementNotAvailableException){}
    }
    if(queue.Count>0)text.AppendLine("[tree truncated at 500 elements / depth 12]");
    var result=D("state_id",Guid.NewGuid().ToString("N"),"app",App(w),"window",WindowInfo(w),"elements",rows,"text",text.ToString(),"snapshot_mode","full","has_image",false);
    string key=StateKey(owner,w);Snapshot previous;
    // 无像素观察保留同窗口最后一帧，但动作仍必须重新核对原帧几何。
    if(States.TryGetValue(key,out previous)){state.Frame=previous.Frame;if(previous.Frame!=null)state.Bounds=previous.Bounds;}
    if(B(args,"include_screenshot")){
      Foreground(w,false);GetWindowRect(w,out rect);
      if(rect.Width<=0||rect.Height<=0||rect.Width>8192||rect.Height>8192||((long)rect.Width*rect.Height)>24000000)Fail("action_unavailable","Window dimensions exceed capture limits");
      using(var bitmap=new Bitmap(rect.Width,rect.Height))using(var g=Graphics.FromImage(bitmap))using(var stream=new MemoryStream()){
        g.CopyFromScreen(rect.Left,rect.Top,0,0,new Size(rect.Width,rect.Height));bitmap.Save(stream,ImageFormat.Png);
        if(stream.Length>8*1024*1024)Fail("action_unavailable","Screenshot exceeds 8 MiB; use accessibility state");
        state.Frame=Guid.NewGuid().ToString("N");state.Bounds=rect;
        result["image"]=Convert.ToBase64String(stream.ToArray());result["frame_id"]=state.Frame;result["width"]=rect.Width;result["height"]=rect.Height;result["has_image"]=true;
      }
    }
    if(States.Count>=128&&!States.ContainsKey(key))Fail("action_unavailable","Close unused Computer Use sessions before observing more windows");
    States[key]=state;return result;
  }
  static Snapshot SnapshotFor(string owner,IntPtr w){Snapshot s;if(!States.TryGetValue(StateKey(owner,w),out s))Fail("STALE_STATE","Observe this window first");else return s;return null;}
  static AutomationElement Element(Snapshot s,Dictionary<string,object> t){
    AutomationElement e;if(S(t,"type")!="element"||!s.Elements.TryGetValue(I(t,"index"),out e))Fail("element_unavailable","Element was not observed");else{
      if(e.Current.ProcessId!=s.Pid||!e.Current.IsEnabled)Fail("element_unavailable","Element is no longer enabled in this window");
      var root=e;int depth=0;while(root!=null&&depth++<64){if(root.Current.NativeWindowHandle==s.Window.ToInt64())return e;root=TreeWalker.ControlViewWalker.GetParent(root);}
      Fail("element_unavailable","Element no longer belongs to the observed window");
    }return null;
  }
  static void Foreground(IntPtr w,bool activate){
    CheckDesktop();if(IsIconic(w))Fail("foreground_required","Restore the target window before using input or screenshots");
    if(activate&&GetForegroundWindow()!=w)SetForegroundWindow(w);
    if(GetForegroundWindow()!=w)Fail("foreground_required","Target window must be in the foreground");
  }
  static void Guard(string owner){if(Cancelled||Stopped.Contains(owner)||(Killed&&Owner==owner))Fail("CONTROL_STOPPED","Computer control stopped by Escape or cancellation");}
  static void Acquire(string owner){
    Guard(owner);if(Owner==owner)return;
    if(Owner!=null)Fail("controller_busy","Another ZCode session owns computer control; stop that session first");
    bool held=false;try{held=Controller.WaitOne(0);}catch(AbandonedMutexException){held=true;}
    if(!held)Fail("controller_busy","Another ZCode window owns computer control; stop that session first");
    Owner=owner;Killed=false;
  }
  static void Release(string owner){
    if(owner!=null&&Owner==owner){Owner=null;Killed=false;Controller.ReleaseMutex();}
    if(owner!=null)foreach(var k in States.Keys.Where(k=>k.StartsWith(owner+"/",StringComparison.Ordinal)).ToArray())States.Remove(k);
  }
  static Point Position(Snapshot s,Dictionary<string,object> target){
    Rect current=new Rect();if(!IsWindow(s.Window)||Pid(s.Window)!=s.Pid||!GetWindowRect(s.Window,out current))Fail("STALE_STATE","Window was replaced");
    Point point;
    if(S(target,"type")=="element"){
      var r=Element(s,target).Current.BoundingRectangle;if(r.IsEmpty)Fail("element_unavailable","Element has no visible bounds");
      point=new Point((int)(r.X+r.Width/2),(int)(r.Y+r.Height/2));
    }else{
      if(s.Frame==null||(target.ContainsKey("frame_id")&&S(target,"frame_id")!=s.Frame))Fail("STALE_STATE","Observe a screenshot before coordinate input");
      if(current.Left!=s.Bounds.Left||current.Top!=s.Bounds.Top||current.Right!=s.Bounds.Right||current.Bottom!=s.Bounds.Bottom)Fail("STALE_STATE","Window moved or resized; observe a fresh screenshot");
      int x=I(target,"x"),y=I(target,"y");if(x<0||y<0||x>=s.Bounds.Width||y>=s.Bounds.Height)Fail("invalid_request","Coordinate outside returned raster");
      point=new Point(s.Bounds.Left+x,s.Bounds.Top+y);
    }
    if(GetAncestor(WindowFromPoint(point),2)!=s.Window)Fail("foreground_required","The target point is covered by another window");return point;
  }
  static void Send(Input input){Sent=true;if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1)Fail("permission_denied","Windows rejected input (possibly elevated or secure target)");}
  static void MouseEvent(uint flags,int data=0){Send(new Input{type=0,data=new InputData{mouse=new Mouse{flags=flags,data=unchecked((uint)data)}}});}
  static void Key(ushort key,bool up=false,ushort scan=0){Send(new Input{type=1,data=new InputData{keyboard=new Keyboard{key=key,scan=scan,flags=(uint)((up?2:0)+(scan!=0?4:0))}}});}
  static ushort KeyCode(string name){
    string n=name.ToUpperInvariant();var map=new Dictionary<string,ushort>{{"CTRL",17},{"CONTROL",17},{"ALT",18},{"SHIFT",16},{"SUPER",91},{"WIN",91},{"META",91},{"ENTER",13},{"RETURN",13},{"TAB",9},{"ESC",27},{"ESCAPE",27},{"BACKSPACE",8},{"DELETE",46},{"SPACE",32},{"LEFT",37},{"UP",38},{"RIGHT",39},{"DOWN",40},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34},{"INSERT",45}};
    ushort v;if(map.TryGetValue(n,out v))return v;if(n.Length==1&&((n[0]>='A'&&n[0]<='Z')||(n[0]>='0'&&n[0]<='9')))return (ushort)n[0];
    int f;if(n.StartsWith("F")&&Int32.TryParse(n.Substring(1),out f)&&f>=1&&f<=24)return (ushort)(111+f);
    Fail("action_unavailable","Unsupported key name: "+name);return 0;
  }
  static ushort[] Chord(string text){return text.Split(new[]{'+'},StringSplitOptions.RemoveEmptyEntries).Select(KeyCode).ToArray();}
  static void Keys(IntPtr w,string owner,string chord,int repeat,double hold){
    var keys=Chord(chord);if(keys.Length==0)Fail("invalid_request","Empty key chord");
    for(int i=0;i<repeat;i++){Guard(owner);Foreground(w,true);Injecting=keys.Contains((ushort)27);var down=new List<ushort>();try{foreach(var k in keys){Key(k);down.Add(k);}var wait=Stopwatch.StartNew();while(wait.Elapsed.TotalSeconds<hold){Guard(owner);Thread.Sleep(10);}}finally{down.Reverse();foreach(var k in down)Key(k,true);Injecting=false;}}
  }
  static void Semantic(AutomationElement e,string action){
    if(!Actions(e).Contains(action))Fail("action_unavailable","Action not advertised by the observed element");Sent=true;object p;
    switch(action){
      case "Invoke":e.TryGetCurrentPattern(InvokePattern.Pattern,out p);((InvokePattern)p).Invoke();break;
      case "Toggle":e.TryGetCurrentPattern(TogglePattern.Pattern,out p);((TogglePattern)p).Toggle();break;
      case "Select":e.TryGetCurrentPattern(SelectionItemPattern.Pattern,out p);((SelectionItemPattern)p).Select();break;
      case "Expand":e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out p);((ExpandCollapsePattern)p).Expand();break;
      case "Collapse":e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out p);((ExpandCollapsePattern)p).Collapse();break;
      case "Focus":e.SetFocus();break;
    }
  }
  static object Act(string method,Dictionary<string,object> args,string owner){
    IntPtr w=Resolve(Obj(V(args,"app_ref")));Acquire(owner);CheckDesktop();
    Snapshot state=SnapshotFor(owner,w);var target=Obj(V(args,"target"));string strategy=S(args,"strategy","auto");object pattern;
    if(method=="set_value"){
      var e=Element(state,target);if(e.Current.IsPassword||!e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)||((ValuePattern)pattern).Current.IsReadOnly)Fail("not_settable","Element does not expose an editable ValuePattern");
      e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern);Sent=true;((ValuePattern)pattern).SetValue(S(args,"value"));
    }else if(method=="perform_action")Semantic(Element(state,target),S(args,"action"));
    else if(method=="select_text"){
      var e=Element(state,target);if(e.Current.IsPassword||!e.TryGetCurrentPattern(TextPattern.Pattern,out pattern))Fail("not_selectable","Element does not expose TextPattern");
      e.TryGetCurrentPattern(TextPattern.Pattern,out pattern);var range=((TextPattern)pattern).DocumentRange.Clone();var values=(object[])args["text_range"];int start=Convert.ToInt32(values[0]),length=Convert.ToInt32(values[1]);
      if(start+length>range.GetText(8192).Length)Fail("not_selectable","Text range no longer exists");range.MoveEndpointByRange(TextPatternRangeEndpoint.End,range,TextPatternRangeEndpoint.Start);
      range.MoveEndpointByUnit(TextPatternRangeEndpoint.Start,TextUnit.Character,start);range.MoveEndpointByUnit(TextPatternRangeEndpoint.End,TextUnit.Character,length);Sent=true;range.Select();
    }else if(method=="left_click"&&S(target,"type")=="element"&&strategy!="event"&&S(args,"mouse_button","left")=="left"&&I(args,"click_count",1)==1&&S(args,"modifiers")==""){
      var e=Element(state,target);var action=Actions(e).FirstOrDefault(a=>a=="Invoke"||a=="Toggle"||a=="Select");
      if(action!=null)Semantic(e,action);else{if(strategy=="a11y")Fail("action_unavailable","Element has no semantic click action");Click(state,target,args,owner);}
    }else if(method=="left_click")Click(state,target,args,owner);
    else if(method=="key"){
      if(strategy=="a11y")Fail("action_unavailable","Keyboard input requires the event strategy");Keys(w,owner,S(args,"text"),I(args,"repeat",1),Convert.ToDouble(V(args,"hold_seconds",0)));
    }else if(method=="type"||method=="paste"){
      if(strategy=="a11y")Fail("action_unavailable","Use setValue for semantic text replacement");
      if(args.ContainsKey("target")){Sent=true;Element(state,target).SetFocus();}Foreground(w,true);
      foreach(char c in S(args,"text")){Guard(owner);Foreground(w,false);Key(0,false,c);Key(0,true,c);}
    }else if(method=="scroll"){
      bool semantic=false;
      if(S(target,"type")=="element"&&strategy!="event"){
        var e=Element(state,target);if(e.TryGetCurrentPattern(ScrollPattern.Pattern,out pattern)){
          var scroll=(ScrollPattern)pattern;string direction=S(args,"scroll_direction");var amount=(direction=="up"||direction=="left")?ScrollAmount.LargeDecrement:ScrollAmount.LargeIncrement;
          for(int i=0;i<I(args,"scroll_amount",1);i++){Guard(owner);Sent=true;scroll.Scroll((direction=="left"||direction=="right")?amount:ScrollAmount.NoAmount,(direction=="up"||direction=="down")?amount:ScrollAmount.NoAmount);}semantic=true;
        }
      }
      if(!semantic){if(strategy=="a11y")Fail("action_unavailable","Element has no ScrollPattern");Foreground(w,true);var p=Position(state,target);SetCursorPos(p.X,p.Y);string d=S(args,"scroll_direction");MouseEvent((d=="left"||d=="right")?0x1000u:0x800u,120*I(args,"scroll_amount",1)*((d=="down"||d=="left")?-1:1));}
    }else if(method=="left_click_drag"){
      if(strategy=="a11y")Fail("action_unavailable","Drag requires pointer events");Foreground(w,true);var from=Position(state,Obj(V(args,"from_target")));var to=Position(state,Obj(V(args,"to")));var modifiers=Chord(S(args,"modifiers"));var down=new List<ushort>();bool mouseDown=false;
      try{foreach(var k in modifiers){Key(k);down.Add(k);}SetCursorPos(from.X,from.Y);MouseEvent(2);mouseDown=true;for(int i=1;i<=16;i++){Guard(owner);Foreground(w,false);SetCursorPos(from.X+(to.X-from.X)*i/16,from.Y+(to.Y-from.Y)*i/16);Thread.Sleep(8);}}finally{if(mouseDown)MouseEvent(4);down.Reverse();foreach(var k in down)Key(k,true);}
    }else Fail("action_unavailable","Unsupported Windows action");
    if(S(args,"return_state","none")!="none")return Observe(D("app_ref",V(args,"app_ref")),owner);
    return D("action_sent",Sent,"dispatch_status","sent","app",App(w));
  }
  static void Click(Snapshot state,Dictionary<string,object> target,Dictionary<string,object> args,string owner){
    if(S(args,"strategy")=="a11y")Fail("action_unavailable","No semantic click action");Foreground(state.Window,true);var p=Position(state,target);var keys=Chord(S(args,"modifiers"));var down=new List<ushort>();string button=S(args,"mouse_button","left");uint press=button=="right"?8u:button=="middle"?32u:2u;
    try{foreach(var k in keys){Key(k);down.Add(k);}SetCursorPos(p.X,p.Y);for(int i=0;i<I(args,"click_count",1);i++){Guard(owner);Foreground(state.Window,false);try{MouseEvent(press);}finally{MouseEvent(press*2);}}}finally{down.Reverse();foreach(var k in down)Key(k,true);}
  }
  public static string Handle(string line){
    Sent=false;try{
      var request=Obj(Json.DeserializeObject(line));string method=S(request,"method"),owner=S(request,"owner");var args=Obj(V(request,"args"));
      if(method=="release"){Release(owner);return Json.Serialize(D("stopped",true));}
      Guard(owner);object result;
      if(method=="list_apps")result=D("apps",Windows().GroupBy(Pid).Select(g=>(object)App(g.First())).ToArray());
      else if(method=="list_windows")result=D("windows",Matches(Obj(V(args,"app_ref"))).Select(WindowInfo).ToArray());
      else if(method=="get_app_state")result=Observe(args,owner);
      else if(method=="request_access"){CheckDesktop();result=D("platform","win32","accessibility","granted","screen_recording","granted","note","Windows enforces per-target integrity and foreground permissions; Escape stops control.");}
      else result=Act(method,args,owner);
      return Json.Serialize(result);
    }catch(Exception ex){var f=ex as Failure;string code=f!=null?f.Code:ex is ElementNotAvailableException?"element_unavailable":ex is UnauthorizedAccessException?"permission_denied":"internal";return Json.Serialize(D("error",D("code",code,"message",ex.Message,"action_sent",Sent)));}
  }
}
`;
