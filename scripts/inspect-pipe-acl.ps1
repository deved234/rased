param([Parameter(Mandatory=$true)][string]$PipeName)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RasedPipeSecurity {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] public static extern uint GetNamedSecurityInfo(string name,int type,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr sd);
  [DllImport("advapi32.dll")] public static extern uint GetSecurityInfo(IntPtr handle,int type,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr sd);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr attributes,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd,uint revision,uint flags,out IntPtr result,out uint length);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr handle);
}
'@
$owner=[IntPtr]::Zero; $group=[IntPtr]::Zero; $dacl=[IntPtr]::Zero; $sacl=[IntPtr]::Zero; $sd=[IntPtr]::Zero
$handle=[RasedPipeSecurity]::CreateFile($PipeName,0x20000,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
if($handle -eq [IntPtr](-1)){throw "Cannot open pipe for ACL inspection: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
try {$result=[RasedPipeSecurity]::GetSecurityInfo($handle,6,4,[ref]$owner,[ref]$group,[ref]$dacl,[ref]$sacl,[ref]$sd)} finally {[void][RasedPipeSecurity]::CloseHandle($handle)}
if($result -ne 0){throw "Pipe ACL read failed: $result"}
try {
  $text=[IntPtr]::Zero; $length=[uint32]0
  if(-not [RasedPipeSecurity]::ConvertSecurityDescriptorToStringSecurityDescriptor($sd,1,4,[ref]$text,[ref]$length)){throw 'Could not format pipe ACL'}
  try {[Runtime.InteropServices.Marshal]::PtrToStringUni($text)} finally {[void][RasedPipeSecurity]::LocalFree($text)}
} finally {[void][RasedPipeSecurity]::LocalFree($sd)}
