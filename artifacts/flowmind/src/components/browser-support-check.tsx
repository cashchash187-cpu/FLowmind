import { useState, useEffect } from "react";
import { AlertOctagon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface BrowserInfo {
  speechSupported: boolean;
  micPermission: "granted" | "denied" | "prompt" | "unknown";
  browserName: string;
  osName: string;
  deviceType: "mobile" | "tablet" | "desktop";
}

async function detectBrowser(): Promise<BrowserInfo> {
  const speechSupported = !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );

  let browserName = "Unknown";
  let osName = "Unknown";
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";

  try {
    const { UAParser } = await import("ua-parser-js");
    const parser = new UAParser();
    const result = parser.getResult();
    browserName = result.browser.name ?? "Unknown";
    osName = result.os.name ?? "Unknown";
    const dt = result.device.type;
    deviceType = dt === "mobile" ? "mobile" : dt === "tablet" ? "tablet" : "desktop";
  } catch {}

  let micPermission: BrowserInfo["micPermission"] = "unknown";
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
    micPermission = perm.state as BrowserInfo["micPermission"];
  } catch {
    micPermission = "unknown";
  }

  return { speechSupported, micPermission, browserName, osName, deviceType };
}

function getGuidance(osName: string, deviceType: string): string {
  const os = osName.toLowerCase();
  if (os.includes("ios") || os.includes("iphone") || os.includes("ipad")) {
    return "Use Safari 14.5+ on iOS for limited support, or open this in Chrome/Edge on desktop.";
  }
  if (os.includes("android") || deviceType === "mobile") {
    return "Use Chrome on Android.";
  }
  return "Use Chrome, Edge, or Brave on desktop.";
}

interface Props {
  children: React.ReactNode;
}

export function BrowserSupportCheck({ children }: Props) {
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    detectBrowser().then(setInfo);
  }, []);

  function recheck() {
    setInfo(null);
    detectBrowser().then(setInfo);
  }

  // Loading — show children optimistically
  if (!info) return <>{children}</>;

  // Mic denied
  if (!dismissed && info.micPermission === "denied") {
    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto">
        <Alert variant="destructive" className="rounded-2xl">
          <AlertOctagon className="h-5 w-5" />
          <AlertTitle>Microphone access blocked</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>Click the 🎤 icon in your browser's address bar to allow microphone access, then re-check.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={recheck} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Re-check
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                Continue anyway
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Speech not supported
  if (!dismissed && !info.speechSupported) {
    const guidance = getGuidance(info.osName, info.deviceType);
    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto">
        <Alert className="rounded-2xl border-amber-500/30 bg-amber-500/5">
          <AlertOctagon className="h-5 w-5 text-amber-600" />
          <AlertTitle className="text-amber-700 dark:text-amber-400">Browser not supported</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p className="text-sm">
              FlowMind needs the Web Speech API. You're using{" "}
              <strong>{info.browserName}</strong> on <strong>{info.osName}</strong>.
            </p>
            <p className="text-sm">{guidance}</p>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground text-xs"
              onClick={() => setDismissed(true)}
            >
              Continue anyway (degrades to manual notes only)
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
