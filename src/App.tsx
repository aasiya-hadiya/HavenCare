import { useState } from "react";
import {
  Activity,
  Bot,
  Cpu,
  Database,
  FlaskConical,
  HeartPulse,
  LogIn,
  LogOut,
  Menu,
  Shield,
  Users,
  X,
} from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { SmartCareProvider, useSmartCare } from "./context/SmartCareContext.tsx";
import { AdminConsolePage } from "./pages/AdminConsolePage.tsx";
import { AiAssistantPage } from "./pages/AiAssistantPage.tsx";
import { CaregiverDashboardPage } from "./pages/CaregiverDashboardPage.tsx";
import { DatasetLabPage } from "./pages/DatasetLabPage.tsx";
import { HardwareIntegrationPage } from "./pages/HardwareIntegrationPage.tsx";
import { PatientOverviewPage } from "./pages/PatientOverviewPage.tsx";
import { TrendsAndBaselinePage } from "./pages/TrendsAndBaselinePage.tsx";
import type { UserRole } from "./types/smartcare.ts";

type NavKey =
  | "overview"
  | "trends"
  | "caregiver"
  | "hardware"
  | "dataset_lab"
  | "admin"
  | "assistant";

interface NavItem {
  key: NavKey;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    key: "overview",
    label: "Health Overview",
    icon: <HeartPulse className="w-4 h-4" />,
    roles: ["patient", "caregiver", "admin"],
  },
  {
    key: "trends",
    label: "Trends & Baseline",
    icon: <Activity className="w-4 h-4" />,
    roles: ["patient", "caregiver", "admin"],
  },
  {
    key: "caregiver",
    label: "Caregiver Monitor",
    icon: <Users className="w-4 h-4" />,
    roles: ["caregiver", "admin", "patient"],
  },
  {
    key: "hardware",
    label: "Hardware & ESP32",
    icon: <Cpu className="w-4 h-4" />,
    roles: ["patient", "caregiver", "admin"],
  },
  {
    key: "dataset_lab",
    label: "Dataset Lab",
    icon: <FlaskConical className="w-4 h-4" />,
    roles: ["patient", "caregiver", "admin"],
  },
  {
    key: "admin",
    label: "Admin Console",
    icon: <Shield className="w-4 h-4" />,
    roles: ["admin"],
  },
  {
    key: "assistant",
    label: "AI Assistant",
    icon: <Bot className="w-4 h-4" />,
    roles: ["patient", "caregiver", "admin"],
  },
];

function WorkspaceShell() {
  const {
    user,
    activeRole,
    setActiveRole,
    signInWithGoogle,
    signOutUser,
    authError,
    usingSampleData,
    hasFirestoreWorkspace,
    initializeFirestoreWorkspace,
    patients,
    selectedPatientId,
    setSelectedPatientId,
    selectedPatient,
  } = useSmartCare();

  const [activePage, setActivePage] = useState<NavKey>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [seedingWorkspace, setSeedingWorkspace] = useState(false);

  const handleRoleSwitch = async (role: UserRole) => {
    await setActiveRole(role);
    if (role === "caregiver") setActivePage("caregiver");
    else if (role === "admin") setActivePage("admin");
    else setActivePage("overview");
  };

  const handleCreateFirestoreWorkspace = async () => {
    setSeedingWorkspace(true);
    try {
      await initializeFirestoreWorkspace();
    } finally {
      setSeedingWorkspace(false);
    }
  };

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(activeRole));
  const currentTitle =
    NAV_ITEMS.find((i) => i.key === activePage)?.label ?? "Health Overview";

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-arova-border w-64">
      <div className="px-5 py-5 border-b border-arova-border">
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-lg bg-arova-green text-white flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <HeartPulse className="w-4 h-4" />
          </span>
          <div>
            <div className="text-lg font-bold tracking-tight text-arova-text leading-none">
              AROVA
            </div>
            <div className="text-[11px] text-arova-muted mt-1">
              Wearable Early Warning System
            </div>
          </div>
        </div>
      </div>

      {/* Role Switcher */}
      <div className="p-4 border-b border-arova-border/70 space-y-2">
        <div className="text-xs font-medium text-arova-muted">Active Role View</div>
        <div className="grid grid-cols-3 gap-1 p-1 bg-arova-mint border border-arova-border/70 rounded-lg">
          {(["patient", "caregiver", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => void handleRoleSwitch(r)}
              className={`py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                activeRole === r
                  ? "bg-white text-arova-green-dark font-semibold shadow-sm"
                  : "text-arova-muted hover:text-arova-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
        {visibleNav.map((item) => {
          const active = activePage === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActivePage(item.key);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? "bg-arova-mint text-arova-green-dark font-semibold"
                  : "text-arova-muted hover:bg-arova-mint/50 hover:text-arova-text"
              }`}
            >
              <span className={active ? "text-arova-green" : "text-arova-muted"}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Auth & Workspace Persistence Box */}
      <div className="p-4 border-t border-arova-border space-y-3">
        {user ? (
          <div className="space-y-2.5">
            <div className="text-xs">
              <div className="font-semibold text-arova-text truncate">
                {user.displayName || "Authenticated User"}
              </div>
              <div className="text-arova-muted truncate">{user.email}</div>
            </div>
            {!hasFirestoreWorkspace && (
              <button
                type="button"
                onClick={() => void handleCreateFirestoreWorkspace()}
                disabled={seedingWorkspace}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark disabled:opacity-50 transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                {seedingWorkspace ? "Creating..." : "Create My Firestore Profile"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-arova-text bg-arova-mint border border-arova-border rounded-lg hover:bg-arova-sage/60 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in with Google
            </button>
            <p className="text-xs text-arova-muted leading-snug">
              Sign in to persist patient baselines, alerts, and devices in Firebase Firestore.
            </p>
          </div>
        )}
        {authError && <p className="text-xs text-red-700">{authError}</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-arova-text/30"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex h-full">
            {sidebarContent}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="ml-2 mt-3 h-9 w-9 rounded-lg bg-white border border-arova-border flex items-center justify-center text-arova-text shadow-sm"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Top Bar Contract: Breadcrumb on left, concise single action/selector on right */}
        <header className="bg-white border-b border-arova-border px-4 sm:px-6 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-arova-muted hover:bg-arova-mint hover:text-arova-text"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-arova-muted truncate">
              <span className="font-semibold text-arova-green-dark">AROVA</span>
              <span className="mx-2 text-arova-sage">/</span>
              <span className="font-medium text-arova-text capitalize">{activeRole}</span>
              <span className="mx-2 text-arova-sage">/</span>
              <span>{currentTitle}</span>
              <span className="hidden sm:inline mx-2 text-arova-sage">·</span>
              <span className="hidden sm:inline text-xs text-arova-muted">
                {activePage === "dataset_lab"
                  ? "Public Research Dataset Mode (Non-Clinical)"
                  : usingSampleData
                  ? "Sample Demo Data"
                  : "Firestore Persistence"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activePage === "dataset_lab" ? (
              <span className="px-3 py-1.5 text-xs font-mono font-medium text-arova-green-dark bg-arova-mint border border-arova-sage rounded-lg">
                source: dataset_playback
              </span>
            ) : (
              <select
                aria-label="Select monitored patient"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium text-arova-text bg-arova-mint/60 border border-arova-border rounded-lg max-w-[200px] truncate focus:outline-none focus:border-arova-green"
              >
                {patients.map((p) => (
                  <option key={p.patientId} value={p.patientId}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        {/* Page Viewport */}
        <div className="flex-1 bg-white">
          <main className="p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
            {activePage !== "dataset_lab" && (
              <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-arova-text">
                  {currentTitle}
                </h1>
                <p className="text-sm text-arova-muted mt-1">
                  Monitoring {selectedPatient.displayName}
                  {selectedPatient.ageGroup ? ` · ${selectedPatient.ageGroup}` : ""}
                </p>
              </div>
            )}

            {activePage === "overview" && (
              <PatientOverviewPage onNavigate={(p) => setActivePage(p as NavKey)} />
            )}
            {activePage === "trends" && <TrendsAndBaselinePage />}
            {activePage === "caregiver" && <CaregiverDashboardPage />}
            {activePage === "hardware" && <HardwareIntegrationPage />}
            {activePage === "dataset_lab" && <DatasetLabPage />}
            {activePage === "admin" && <AdminConsolePage />}
            {activePage === "assistant" && <AiAssistantPage />}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SmartCareProvider>
        <WorkspaceShell />
      </SmartCareProvider>
    </ErrorBoundary>
  );
}
