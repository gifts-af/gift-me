// A shared list opens light for a signed-out visitor who hasn't picked a theme.
// In-app browsers report their host app's dark setting, not the phone's:
// Instagram on a Pixel opened a list dark for someone whose phone is light (owner, 2026-11-27).
// It runs in <head>, before next-themes' own script, by saving "light" as
// the visitor's choice, so there's no dark flash. The sun/moon button still switches,
// and a theme already chosen, or a signed-in visitor (a Supabase auth cookie), is left alone.
// Signed-in pages keep following the device.
export const SHARE_LIGHT_SCRIPT = `(function(){try{
if(location.pathname.indexOf("/share/")!==0)return;
if(localStorage.getItem("theme"))return;
if(/(?:^|; )sb-[^=]*-auth-token/.test(document.cookie))return;
localStorage.setItem("theme","light");
}catch(e){}})();`;
