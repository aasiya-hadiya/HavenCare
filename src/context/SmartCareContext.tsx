import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import {
  DEFAULT_SYSTEM_SETTINGS,
  SAMPLE_ALERTS,
  SAMPLE_CARE_LINKS,
  SAMPLE_DEVICES,
  SAMPLE_PATIENTS,
  SAMPLE_READINGS_BY_PATIENT,
} from "../data/sampleData.ts";
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  testFirestoreConnection,
} from "../lib/firebase.ts";
import {
  fetchIntegrationStatus,
  fetchLatestHardwareEvents,
  fetchPatientBaselineStatus,
  requestBaselineFit,
  sendSimulatedWearablePacket,
} from "../services/apiClient.ts";
import {
  VALIDATION_LIMITS,
  type AlertRecord,
  type AnomalyStatus,
  type BaselineProgressSummary,
  type CallEscalationStatus,
  type CareLink,
  type EcgSegmentRecord,
  type EcgSignalQuality,
  type IntegrationStatus,
  type MovementStatus,
  type PatientRecord,
  type SystemSettings,
  type TelemetrySource,
  type UserProfile,
  type UserRole,
  type VitalReading,
  type WearableDevice,
} from "../types/smartcare.ts";

interface SmartCareContextValue {
  authReady: boolean;
  firestoreConnected: boolean;
  user: User | null;
  isAdminUser: boolean;
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  authError: string | null;

  usingSampleData: boolean;
  hasFirestoreWorkspace: boolean;
  initializeFirestoreWorkspace: () => Promise<void>;

  patients: PatientRecord[];
  selectedPatientId: string;
  setSelectedPatientId: (id: string) => void;
  selectedPatient: PatientRecord;

  readings: VitalReading[];
  alerts: AlertRecord[];
  devices: WearableDevice[];
  careLinks: CareLink[];
  registeredUsers: UserProfile[];
  liveHardwareSnapshot: VitalReading | null;
  ecgSegments: EcgSegmentRecord[];
  baselineStatusSummary: {
    esp32Hardware: BaselineProgressSummary;
    simulator: BaselineProgressSummary;
    activeBaseline: BaselineProgressSummary;
  } | null;
  systemSettings: SystemSettings;
  integrations: IntegrationStatus | null;
  refreshIntegrations: () => Promise<void>;

  injectSimulatorReading: (input: {
    heartRate: number | null;
    spo2: number | null;
    temperatureC: number | null;
    accelMagnitude: number;
    gyroMagnitude: number;
    movementStatus: MovementStatus;
    possibleFallDetected?: boolean;
    irSignalOk?: boolean;
    fingerDetected?: boolean;
    ecgSamples?: number[];
    ecgSamplingRate?: number;
    ecgSignalQuality?: EcgSignalQuality;
    ecgLeadOff?: boolean;
    ecgTimestamp?: string;
    source?: TelemetrySource;
  }) => Promise<VitalReading>;
  fitBaselineForSelectedPatient: () => Promise<{ message: string; mlServiceConnected: boolean }>;
  acknowledgeAlert: (alertId: string, followUpAction: string) => Promise<void>;
  resolveAlert: (alertId: string, followUpAction: string) => Promise<void>;
  updateAlertEscalation: (
    alertId: string,
    status: CallEscalationStatus,
    newLogEntries: string[]
  ) => Promise<void>;
  saveDeviceConfig: (device: {
    deviceId: string;
    label: string;
    pulseOxChipVariant: string;
    ecgSensor?: string;
    tempSensor: string;
    samplingIntervalMs: number;
    firmwareVersion: string;
  }) => Promise<void>;
  addCareLink: (input: {
    caregiverName: string;
    caregiverUid: string;
    priority: "primary" | "secondary";
  }) => Promise<void>;
  updateSystemSettings: (next: {
    escalationTimeoutSec: number;
    baselineMinSamples: number;
    samplingDefaultMs: number;
    warningPersistenceWindows?: number;
    criticalPersistenceWindows?: number;
    anomalyScoreThreshold?: number;
  }) => Promise<void>;
}

const SmartCareContext = createContext<SmartCareContextValue | null>(null);

function tsToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === "string") return val;
  if (typeof (val as Timestamp)?.toDate === "function") {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

export function SmartCareProvider({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [activeRole, setActiveRoleState] = useState<UserRole>("patient");
  const [authError, setAuthError] = useState<string | null>(null);

  const [firestorePatients, setFirestorePatients] = useState<PatientRecord[]>([]);
  const [firestoreReadings, setFirestoreReadings] = useState<VitalReading[]>([]);
  const [firestoreAlerts, setFirestoreAlerts] = useState<AlertRecord[]>([]);
  const [firestoreDevices, setFirestoreDevices] = useState<WearableDevice[]>([]);
  const [firestoreCareLinks, setFirestoreCareLinks] = useState<CareLink[]>([]);
  const [firestoreUsers, setFirestoreUsers] = useState<UserProfile[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);

  const [samplePatients, setSamplePatients] = useState<PatientRecord[]>(SAMPLE_PATIENTS);
  const [sampleReadingsMap, setSampleReadingsMap] =
    useState<Record<string, VitalReading[]>>(SAMPLE_READINGS_BY_PATIENT);
  const [sampleAlerts, setSampleAlerts] = useState<AlertRecord[]>(SAMPLE_ALERTS);
  const [sampleDevices, setSampleDevices] = useState<WearableDevice[]>(SAMPLE_DEVICES);
  const [sampleCareLinks, setSampleCareLinks] = useState<CareLink[]>(SAMPLE_CARE_LINKS);

  const [selectedPatientId, setSelectedPatientId] = useState<string>(SAMPLE_PATIENTS[0].patientId);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [liveHardwareSnapshot, setLiveHardwareSnapshot] = useState<VitalReading | null>(null);
  const [serverEcgHistory, setServerEcgHistory] = useState<EcgSegmentRecord[]>([]);
  const [baselineStatusSummary, setBaselineStatusSummary] = useState<{
    esp32Hardware: BaselineProgressSummary;
    simulator: BaselineProgressSummary;
    activeBaseline: BaselineProgressSummary;
  } | null>(null);

  const refreshIntegrations = useCallback(async () => {
    try {
      const data = await fetchIntegrationStatus();
      setIntegrations(data);
    } catch {
      // Leave previous integration state
    }
  }, []);

  useEffect(() => {
    void testFirestoreConnection().then(setFirestoreConnected);
    void refreshIntegrations();
  }, [refreshIntegrations]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (!nextUser) {
        setIsAdminUser(false);
        setFirestorePatients([]);
        setFirestoreReadings([]);
        setFirestoreAlerts([]);
        setFirestoreDevices([]);
        setFirestoreCareLinks([]);
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, "users", nextUser.uid);
        const snap = await getDoc(userRef);
        const isBootstrapAdmin =
          nextUser.email === "aasiyahadiya7575@gmail.com" && nextUser.emailVerified;

        let adminFlag = isBootstrapAdmin;
        if (!adminFlag) {
          try {
            const adminSnap = await getDoc(doc(db, "admins", nextUser.uid));
            adminFlag = adminSnap.exists();
          } catch {
            adminFlag = false;
          }
        }
        setIsAdminUser(adminFlag);

        if (!snap.exists()) {
          const initialRole: UserRole = adminFlag ? "admin" : "patient";
          await setDoc(userRef, {
            uid: nextUser.uid,
            displayName: (nextUser.displayName || nextUser.email || "SmartCare User").slice(
              0,
              VALIDATION_LIMITS.MAX_NAME_LEN
            ),
            role: initialRole,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, "users", nextUser.uid, "private", "contact"), {
            uid: nextUser.uid,
            email: (nextUser.email || "user@example.com").slice(0, 160),
            updatedAt: serverTimestamp(),
          });
          setActiveRoleState(initialRole);
        } else {
          const data = snap.data() as { role?: UserRole };
          if (data.role === "admin" && adminFlag) {
            setActiveRoleState("admin");
          } else if (data.role === "caregiver" || data.role === "patient") {
            setActiveRoleState(data.role);
          }
        }
      } catch (err) {
        console.error("Auth profile sync error:", err);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to Firestore collections when user is authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    const mapPatientDoc = (d: { id: string; data: () => Record<string, unknown> }): PatientRecord => {
      const data = d.data();
      return {
        patientId: String(data.patientId ?? d.id),
        ownerUid: String(data.ownerUid ?? user.uid),
        displayName: String(data.displayName ?? "Patient"),
        ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
        baselineStatus: (data.baselineStatus as PatientRecord["baselineStatus"]) ?? "not_started",
        baselineSamplesCount: Number(data.baselineSamplesCount ?? 0),
        baselineHeartRateMean:
          typeof data.baselineHeartRateMean === "number" ? data.baselineHeartRateMean : undefined,
        baselineSpo2Mean:
          typeof data.baselineSpo2Mean === "number" ? data.baselineSpo2Mean : undefined,
        baselineTempMean:
          typeof data.baselineTempMean === "number" ? data.baselineTempMean : undefined,
        baselineSource: data.baselineSource ? (String(data.baselineSource) as TelemetrySource) : undefined,
        baselineModelTrained:
          typeof data.baselineModelTrained === "boolean" ? data.baselineModelTrained : undefined,
        baselineModelVersion: data.baselineModelVersion ? String(data.baselineModelVersion) : undefined,
        baselineEcgBpmMean:
          typeof data.baselineEcgBpmMean === "number" ? data.baselineEcgBpmMean : undefined,
        baselineActiveHrMean:
          typeof data.baselineActiveHrMean === "number" ? data.baselineActiveHrMean : undefined,
        primaryCaregiverUid: data.primaryCaregiverUid ? String(data.primaryCaregiverUid) : undefined,
        secondaryCaregiverUid: data.secondaryCaregiverUid
          ? String(data.secondaryCaregiverUid)
          : undefined,
        primaryCaregiverName: data.primaryCaregiverName ? String(data.primaryCaregiverName) : undefined,
        secondaryCaregiverName: data.secondaryCaregiverName
          ? String(data.secondaryCaregiverName)
          : undefined,
        dataMode: data.dataMode === "live" ? "live" : "sample",
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    };

    const ownedMap = new Map<string, PatientRecord>();
    const cgMap = new Map<string, PatientRecord>();
    const syncMergedPatients = () => {
      const merged = new Map<string, PatientRecord>([...ownedMap, ...cgMap]);
      const list = Array.from(merged.values());
      setFirestorePatients(list);
      if (list.length > 0 && !list.some((p) => p.patientId === selectedPatientId)) {
        setSelectedPatientId(list[0].patientId);
      }
    };

    const patientsQuery = isAdminUser
      ? query(collection(db, "patients"), limit(50))
      : query(collection(db, "patients"), where("ownerUid", "==", user.uid), limit(25));

    const unsubPatients = onSnapshot(
      patientsQuery,
      (snap) => {
        ownedMap.clear();
        for (const d of snap.docs) {
          const rec = mapPatientDoc(d);
          ownedMap.set(rec.patientId, rec);
        }
        syncMergedPatients();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "patients")
    );

    const unsubCaregiverPatients = isAdminUser
      ? () => {}
      : onSnapshot(
          query(collection(db, "patients"), where("primaryCaregiverUid", "==", user.uid), limit(25)),
          (snap) => {
            cgMap.clear();
            for (const d of snap.docs) {
              const rec = mapPatientDoc(d);
              cgMap.set(rec.patientId, rec);
            }
            syncMergedPatients();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, "patients")
        );

    const devicesQuery = isAdminUser
      ? query(collection(db, "devices"), limit(50))
      : query(collection(db, "devices"), where("ownerUid", "==", user.uid), limit(25));

    const unsubDevices = onSnapshot(
      devicesQuery,
      (snap) => {
        setFirestoreDevices(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              deviceId: String(data.deviceId ?? d.id),
              label: String(data.label ?? "ESP32 Node"),
              patientId: String(data.patientId ?? ""),
              ownerUid: String(data.ownerUid ?? ""),
              boardType: String(data.boardType ?? "ESP32"),
              pulseOxChipVariant: String(data.pulseOxChipVariant ?? "MAX30100 (Confirmed)"),
              ecgSensor: data.ecgSensor ? String(data.ecgSensor) : "AD8232 Provisional ECG",
              imuSensor: String(data.imuSensor ?? "MPU6050"),
              tempSensor: String(data.tempSensor ?? "Configurable (Pending Confirmation)"),
              displayModule: String(data.displayModule ?? "0.96-inch SSD1306 OLED (128x64)"),
              hapticModule: String(data.hapticModule ?? "Vibration Motor (Transistor/MOSFET Driver)"),
              samplingIntervalMs: Number(data.samplingIntervalMs ?? 2000),
              connectionStatus: data.connectionStatus ?? "not_connected",
              lastSeenAt: data.lastSeenAt ? String(data.lastSeenAt) : undefined,
              firmwareVersion: String(data.firmwareVersion ?? "smartcare-max30100-ecg-v2.0"),
              createdAt: tsToIso(data.createdAt),
              updatedAt: tsToIso(data.updatedAt),
            };
          })
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "devices")
    );

    const careQuery = isAdminUser
      ? query(collection(db, "careLinks"), limit(50))
      : query(collection(db, "careLinks"), where("patientOwnerUid", "==", user.uid), limit(25));

    const unsubCare = onSnapshot(
      careQuery,
      (snap) => {
        setFirestoreCareLinks(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              linkId: String(data.linkId ?? d.id),
              patientId: String(data.patientId ?? ""),
              patientName: String(data.patientName ?? ""),
              patientOwnerUid: String(data.patientOwnerUid ?? ""),
              caregiverUid: String(data.caregiverUid ?? ""),
              caregiverName: String(data.caregiverName ?? ""),
              priority: data.priority === "secondary" ? "secondary" : "primary",
              status: data.status ?? "active",
              createdAt: tsToIso(data.createdAt),
              updatedAt: tsToIso(data.updatedAt),
            };
          })
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "careLinks")
    );

    const unsubSettings = onSnapshot(
      doc(db, "systemSettings", "global"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSystemSettings({
            settingId: "global",
            escalationTimeoutSec: Number(data.escalationTimeoutSec ?? 30),
            baselineMinSamples: Number(data.baselineMinSamples ?? 20),
            samplingDefaultMs: Number(data.samplingDefaultMs ?? 2000),
            warningPersistenceWindows: Number(data.warningPersistenceWindows ?? 2),
            criticalPersistenceWindows: Number(data.criticalPersistenceWindows ?? 3),
            anomalyScoreThreshold: Number(data.anomalyScoreThreshold ?? -0.05),
            updatedByUid: String(data.updatedByUid ?? ""),
            updatedAt: tsToIso(data.updatedAt),
          });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, "systemSettings/global")
    );

    const unsubUsers = isAdminUser
      ? onSnapshot(
          query(collection(db, "users"), limit(50)),
          (snap) => {
            setFirestoreUsers(
              snap.docs.map((d) => {
                const data = d.data();
                return {
                  uid: String(data.uid ?? d.id),
                  displayName: String(data.displayName ?? "User"),
                  role: (data.role as UserRole) ?? "patient",
                  createdAt: tsToIso(data.createdAt),
                  updatedAt: tsToIso(data.updatedAt),
                };
              })
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, "users")
        )
      : () => {};

    return () => {
      unsubPatients();
      unsubCaregiverPatients();
      unsubDevices();
      unsubCare();
      unsubSettings();
      unsubUsers();
    };
  }, [authReady, user, isAdminUser]);

  // Subscribe to readings & alerts for active Firestore patient
  useEffect(() => {
    if (!authReady || !user) return;
    const isFirestorePatient = firestorePatients.some((p) => p.patientId === selectedPatientId);
    if (!isFirestorePatient) {
      setFirestoreReadings([]);
      setFirestoreAlerts([]);
      return;
    }

    const activePt = firestorePatients.find((p) => p.patientId === selectedPatientId);
    const scopeField =
      activePt?.primaryCaregiverUid === user.uid && activePt.ownerUid !== user.uid
        ? "primaryCaregiverUid"
        : activePt?.secondaryCaregiverUid === user.uid && activePt.ownerUid !== user.uid
        ? "secondaryCaregiverUid"
        : "ownerUid";

    const readingsRef = collection(db, "patients", selectedPatientId, "readings");
    const readingsQuery = isAdminUser
      ? query(readingsRef, orderBy("createdAt", "desc"), limit(40))
      : query(
          readingsRef,
          where(scopeField, "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(40)
        );

    const unsubReadings = onSnapshot(
      readingsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              readingId: String(data.readingId ?? d.id),
              patientId: String(data.patientId ?? selectedPatientId),
              ownerUid: String(data.ownerUid ?? user.uid),
              heartRate: typeof data.heartRate === "number" ? data.heartRate : null,
              spo2: typeof data.spo2 === "number" ? data.spo2 : null,
              temperatureC: typeof data.temperatureC === "number" ? data.temperatureC : null,
              movementStatus: data.movementStatus ?? "resting",
              accelMagnitude: typeof data.accelMagnitude === "number" ? data.accelMagnitude : 1.0,
              gyroMagnitude: typeof data.gyroMagnitude === "number" ? data.gyroMagnitude : 3.0,
              possibleFallDetected: Boolean(data.possibleFallDetected),
              ecgSamples: Array.isArray(data.ecgSamples) ? data.ecgSamples.map(Number) : undefined,
              ecgSamplingRate: typeof data.ecgSamplingRate === "number" ? data.ecgSamplingRate : undefined,
              ecgSignalQuality: data.ecgSignalQuality as EcgSignalQuality | undefined,
              ecgLeadOff: typeof data.ecgLeadOff === "boolean" ? data.ecgLeadOff : undefined,
              ecgTimestamp: data.ecgTimestamp ? String(data.ecgTimestamp) : undefined,
              ecgHeartRateBpm: typeof data.ecgHeartRateBpm === "number" ? data.ecgHeartRateBpm : undefined,
              signalQuality: data.signalQuality ?? "good",
              anomalyStatus: data.anomalyStatus as AnomalyStatus | undefined,
              anomalyScore: Number(data.anomalyScore ?? 0),
              alertLevel: data.alertLevel ?? "Normal",
              contributingFeatures: Array.isArray(data.contributingFeatures)
                ? data.contributingFeatures.map(String)
                : undefined,
              persistenceCount:
                typeof data.persistenceCount === "number" ? data.persistenceCount : undefined,
              modelVersion: data.modelVersion ? String(data.modelVersion) : undefined,
              source: data.source ?? "simulator",
              mlEngine: data.mlEngine ?? "unconnected_rule_check",
              explanation: String(data.explanation ?? ""),
              createdAt: tsToIso(data.createdAt),
            } as VitalReading;
          })
          .reverse();
        setFirestoreReadings(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `patients/${selectedPatientId}/readings`)
    );

    const alertsRef = collection(db, "patients", selectedPatientId, "alerts");
    const alertsQuery = isAdminUser
      ? query(alertsRef, orderBy("createdAt", "desc"), limit(30))
      : query(
          alertsRef,
          where(scopeField, "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(30)
        );

    const unsubAlerts = onSnapshot(
      alertsQuery,
      (snap) => {
        setFirestoreAlerts(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              alertId: String(data.alertId ?? d.id),
              patientId: String(data.patientId ?? selectedPatientId),
              ownerUid: String(data.ownerUid ?? user.uid),
              level: data.level === "Critical" ? "Critical" : "Warning",
              status: data.status ?? "active",
              title: String(data.title ?? "Alert"),
              explanation: String(data.explanation ?? ""),
              triggeredMetrics: Array.isArray(data.triggeredMetrics)
                ? data.triggeredMetrics.map(String)
                : [],
              source: data.source ?? "simulator",
              acknowledgedByUid: data.acknowledgedByUid ? String(data.acknowledgedByUid) : undefined,
              acknowledgedByName: data.acknowledgedByName
                ? String(data.acknowledgedByName)
                : undefined,
              followUpAction: data.followUpAction ? String(data.followUpAction) : undefined,
              callEscalationStatus: data.callEscalationStatus ?? "not_triggered",
              callLog: Array.isArray(data.callLog) ? data.callLog.map(String) : [],
              createdAt: tsToIso(data.createdAt),
              updatedAt: tsToIso(data.updatedAt),
            } as AlertRecord;
          })
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `patients/${selectedPatientId}/alerts`)
    );

    return () => {
      unsubReadings();
      unsubAlerts();
    };
  }, [authReady, user, isAdminUser, selectedPatientId, firestorePatients]);

  const hasFirestoreWorkspace = Boolean(user && firestorePatients.length > 0);
  const usingSampleData = !hasFirestoreWorkspace;

  const patients = hasFirestoreWorkspace ? firestorePatients : samplePatients;
  const selectedPatient = useMemo(
    () => patients.find((p) => p.patientId === selectedPatientId) ?? patients[0],
    [patients, selectedPatientId]
  );

  const readings = useMemo(() => {
    if (hasFirestoreWorkspace) return firestoreReadings;
    return sampleReadingsMap[selectedPatient.patientId] ?? [];
  }, [hasFirestoreWorkspace, firestoreReadings, sampleReadingsMap, selectedPatient.patientId]);

  const alerts = useMemo(() => {
    if (hasFirestoreWorkspace) return firestoreAlerts;
    return sampleAlerts;
  }, [hasFirestoreWorkspace, firestoreAlerts, sampleAlerts]);

  const devices = hasFirestoreWorkspace ? firestoreDevices : sampleDevices;
  const careLinks = hasFirestoreWorkspace ? firestoreCareLinks : sampleCareLinks;
  const registeredUsers: UserProfile[] = useMemo(() => {
    if (user && firestoreUsers.length > 0) return firestoreUsers;
    const base: UserProfile[] = [
      { uid: "sample_owner_elena", displayName: "Elena Rostova (Sample)", role: "patient" },
      { uid: "sample_owner_arthur", displayName: "Arthur Vance (Sample)", role: "patient" },
      { uid: "sample_cg_maya", displayName: "Maya Lin (Sample Caregiver)", role: "caregiver" },
      { uid: "sample_cg_david", displayName: "David Rostov (Sample Caregiver)", role: "caregiver" },
    ];
    if (user) {
      base.unshift({
        uid: user.uid,
        displayName: user.displayName || user.email || "Current User",
        role: activeRole,
      });
    }
    return base;
  }, [user, firestoreUsers, activeRole]);

  // Poll /api/wearable/latest so live ESP32 hardware packets & ECG segments appear on the dashboard
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchLatestHardwareEvents(selectedPatient.patientId);
        if (!active) return;
        setServerEcgHistory(Array.isArray(res.ecgHistory) ? res.ecgHistory : []);

        try {
          const bStatus = await fetchPatientBaselineStatus(
            selectedPatient.patientId,
            systemSettings.baselineMinSamples
          );
          if (active) setBaselineStatusSummary(bStatus);
        } catch {
          // Non-fatal
        }

        const snap = res.snapshot;
        if (!snap || snap.source !== "esp32_hardware") {
          setLiveHardwareSnapshot(null);
          return;
        }
        const receivedAt = String(snap.receivedAt ?? "");
        const ageMs = Date.now() - new Date(receivedAt).getTime();
        if (Number.isFinite(ageMs) && ageMs <= 60_000) {
          const features = (snap.ecgFeatures ?? {}) as { estimatedEcgBpm?: number | null };
          setLiveHardwareSnapshot({
            readingId: `hw_${receivedAt}`,
            patientId: String(snap.patientId ?? selectedPatient.patientId),
            ownerUid: selectedPatient.ownerUid,
            heartRate: typeof snap.heartRate === "number" ? snap.heartRate : null,
            spo2: typeof snap.spo2 === "number" ? snap.spo2 : null,
            temperatureC: typeof snap.temperatureC === "number" ? snap.temperatureC : null,
            movementStatus: (snap.movementStatus as MovementStatus) ?? "resting",
            accelMagnitude: Number(snap.accelMagnitude ?? 1),
            gyroMagnitude: Number(snap.gyroMagnitude ?? 0),
            possibleFallDetected: Boolean(snap.possibleFallDetected),
            ecgSamples: Array.isArray(snap.ecgSamples) ? snap.ecgSamples.map(Number) : undefined,
            ecgSamplingRate: typeof snap.ecgSamplingRate === "number" ? snap.ecgSamplingRate : undefined,
            ecgSignalQuality: (snap.ecgSignalQuality as EcgSignalQuality) ?? "unavailable",
            ecgLeadOff: Boolean(snap.ecgLeadOff),
            ecgTimestamp: snap.ecgTimestamp ? String(snap.ecgTimestamp) : receivedAt,
            ecgHeartRateBpm:
              typeof features.estimatedEcgBpm === "number" ? features.estimatedEcgBpm : undefined,
            signalQuality: (snap.signalQuality as VitalReading["signalQuality"]) ?? "good",
            anomalyStatus: snap.anomalyStatus as AnomalyStatus | undefined,
            anomalyScore: Number(snap.anomalyScore ?? 0),
            alertLevel: (snap.alertLevel as VitalReading["alertLevel"]) ?? "Normal",
            contributingFeatures: Array.isArray(snap.contributingFeatures)
              ? snap.contributingFeatures.map(String)
              : undefined,
            persistenceCount:
              typeof snap.persistenceCount === "number" ? snap.persistenceCount : undefined,
            modelVersion: snap.modelVersion ? String(snap.modelVersion) : undefined,
            source: "esp32_hardware",
            mlEngine: (snap.mlEngine as VitalReading["mlEngine"]) ?? "unconnected_rule_check",
            explanation: String(snap.explanation ?? ""),
            createdAt: receivedAt,
          });
        } else {
          setLiveHardwareSnapshot(null);
        }
      } catch {
        // Keep last state
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedPatient.patientId, selectedPatient.ownerUid, systemSettings.baselineMinSamples]);

  const ecgSegments: EcgSegmentRecord[] = useMemo(() => {
    const hwSegs = serverEcgHistory.filter((s) => s.source === "esp32_hardware");
    const readingSegs: EcgSegmentRecord[] = [...readings]
      .reverse()
      .filter((r) => (Array.isArray(r.ecgSamples) && r.ecgSamples.length > 0) || r.ecgLeadOff)
      .map((r) => ({
        segmentId: `rd_ecg_${r.readingId}`,
        deviceId: devices.find((d) => d.patientId === r.patientId)?.deviceId ?? "wearable",
        patientId: r.patientId,
        samples: r.ecgSamples ?? [],
        samplingRate: r.ecgSamplingRate ?? 200,
        signalQuality: r.ecgSignalQuality ?? (r.ecgLeadOff ? "lead_off" : "good"),
        leadOff: Boolean(r.ecgLeadOff),
        timestamp: r.ecgTimestamp ?? r.createdAt,
        features: r.ecgHeartRateBpm
          ? {
              samplingRateHz: r.ecgSamplingRate ?? 200,
              sampleCount: r.ecgSamples?.length ?? 0,
              rPeakCount: 0,
              estimatedEcgBpm: r.ecgHeartRateBpm,
              rrIntervalMeanMs: null,
              rrVariabilityMs: null,
              amplitudeRange: 0,
              signalQuality: r.ecgSignalQuality ?? "good",
            }
          : undefined,
        source: r.source,
      }));
    return [...hwSegs, ...readingSegs];
  }, [serverEcgHistory, readings, devices]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google Sign-In failed.");
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    setSelectedPatientId(SAMPLE_PATIENTS[0].patientId);
  }, []);

  const setActiveRole = useCallback(
    async (role: UserRole) => {
      setActiveRoleState(role);
      if (user && (role !== "admin" || isAdminUser)) {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            role,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
        }
      }
    },
    [user, isAdminUser]
  );

  const initializeFirestoreWorkspace = useCallback(async () => {
    if (!user) return;
    const patientId = sanitizeId(`pt_${user.uid.slice(0, 16)}`, "pt");
    const deviceId = sanitizeId(`esp32_${user.uid.slice(0, 12)}`, "esp32");
    const patientName = (user.displayName || user.email || "My Patient Profile").slice(
      0,
      VALIDATION_LIMITS.MAX_NAME_LEN
    );

    try {
      await setDoc(doc(db, "patients", patientId), {
        patientId,
        ownerUid: user.uid,
        displayName: patientName,
        ageGroup: "Adult · Personalized Baseline",
        baselineStatus: "collecting",
        baselineSamplesCount: 6,
        baselineHeartRateMean: 73.0,
        baselineSpo2Mean: 97.9,
        baselineTempMean: 36.6,
        primaryCaregiverName: "Primary Caregiver (Unassigned)",
        secondaryCaregiverName: "Secondary Caregiver (Unassigned)",
        dataMode: "sample",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const starterSamples = SAMPLE_READINGS_BY_PATIENT.sample_patient_elena.slice(-6);
      for (let i = 0; i < starterSamples.length; i++) {
        const s = starterSamples[i];
        const readingId = `init_${Date.now()}_${i}`;
        await setDoc(doc(db, "patients", patientId, "readings", readingId), {
          readingId,
          patientId,
          ownerUid: user.uid,
          heartRate: s.heartRate,
          spo2: s.spo2,
          temperatureC: s.temperatureC,
          movementStatus: s.movementStatus,
          accelMagnitude: s.accelMagnitude ?? 1.0,
          gyroMagnitude: s.gyroMagnitude ?? 3.0,
          signalQuality: s.signalQuality,
          anomalyScore: s.anomalyScore,
          alertLevel: s.alertLevel,
          source: "sample_demo",
          mlEngine: "unconnected_rule_check",
          explanation: s.explanation.slice(0, VALIDATION_LIMITS.MAX_EXPLANATION_LEN),
          createdAt: serverTimestamp(),
        });
      }

      await setDoc(doc(db, "devices", deviceId), {
        deviceId,
        label: "ESP32 Wearable Node #1",
        patientId,
        ownerUid: user.uid,
        boardType: "ESP32 DevKit v1 (Wi-Fi)",
        pulseOxChipVariant: "MAX30100 (Confirmed)",
        ecgSensor: "AD8232 Provisional ECG (ADC1 + LO+/LO-)",
        imuSensor: "MPU6050 6-Axis IMU",
        tempSensor: "Configurable (Model Pending Confirmation)",
        displayModule: "0.96-inch SSD1306 I2C OLED (128x64)",
        hapticModule: "Vibration Motor (Transistor/MOSFET Driver)",
        samplingIntervalMs: 2000,
        connectionStatus: "not_connected",
        firmwareVersion: "smartcare-max30100-ecg-v2.0",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedPatientId(patientId);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `patients/${patientId}`);
    }
  }, [user]);

  const injectSimulatorReading = useCallback(
    async (input: {
      heartRate: number | null;
      spo2: number | null;
      temperatureC: number | null;
      accelMagnitude: number;
      gyroMagnitude: number;
      movementStatus: MovementStatus;
      possibleFallDetected?: boolean;
      irSignalOk?: boolean;
      fingerDetected?: boolean;
      ecgSamples?: number[];
      ecgSamplingRate?: number;
      ecgSignalQuality?: EcgSignalQuality;
      ecgLeadOff?: boolean;
      ecgTimestamp?: string;
      source?: TelemetrySource;
    }): Promise<VitalReading> => {
      const targetPatient = selectedPatient;
      const deviceId = devices.find((d) => d.patientId === targetPatient.patientId)?.deviceId ?? "sim_esp32_01";
      const baselineMeans =
        typeof targetPatient.baselineHeartRateMean === "number" &&
        typeof targetPatient.baselineSpo2Mean === "number" &&
        typeof targetPatient.baselineTempMean === "number"
          ? {
              heartRate: targetPatient.baselineHeartRateMean,
              spo2: targetPatient.baselineSpo2Mean,
              temperatureC: targetPatient.baselineTempMean,
            }
          : undefined;

      const res = await sendSimulatedWearablePacket({
        deviceId,
        patientId: targetPatient.patientId,
        timestamp: new Date().toISOString(),
        heartRate: input.heartRate,
        spo2: input.spo2,
        temperatureC: input.temperatureC,
        accelMagnitude: input.accelMagnitude,
        gyroMagnitude: input.gyroMagnitude,
        movementStatus: input.movementStatus,
        possibleFallDetected: input.possibleFallDetected,
        irSignalOk: input.irSignalOk ?? true,
        fingerDetected: input.fingerDetected ?? true,
        ecgSamples: input.ecgSamples,
        ecgSamplingRate: input.ecgSamplingRate,
        ecgSignalQuality: input.ecgSignalQuality,
        ecgLeadOff: input.ecgLeadOff,
        ecgTimestamp: input.ecgTimestamp,
        source: input.source ?? "simulator",
        baselineMeans,
        baselineTrained: targetPatient.baselineStatus === "ready",
        policyConfig: {
          baselineMinSamples: systemSettings.baselineMinSamples,
          warningPersistenceWindows: systemSettings.warningPersistenceWindows ?? 2,
          criticalPersistenceWindows: systemSettings.criticalPersistenceWindows ?? 3,
          anomalyScoreWarningThreshold: systemSettings.anomalyScoreThreshold ?? -0.05,
        },
      });

      const boundedEcg = Array.isArray(res.ecgSamples)
        ? res.ecgSamples.slice(0, VALIDATION_LIMITS.MAX_ECG_BATCH)
        : undefined;
      const readingId = `rd_${Date.now()}`;
      const newReading: VitalReading = {
        readingId,
        patientId: targetPatient.patientId,
        ownerUid: targetPatient.ownerUid,
        primaryCaregiverUid: targetPatient.primaryCaregiverUid,
        secondaryCaregiverUid: targetPatient.secondaryCaregiverUid,
        heartRate: res.heartRate,
        spo2: res.spo2,
        temperatureC: res.temperatureC,
        movementStatus: res.movementStatus,
        accelMagnitude: res.accelMagnitude,
        gyroMagnitude: res.gyroMagnitude,
        possibleFallDetected: res.possibleFallDetected,
        ecgSamples: boundedEcg,
        ecgSamplingRate: res.ecgSamplingRate,
        ecgSignalQuality: res.ecgSignalQuality,
        ecgLeadOff: res.ecgLeadOff,
        ecgTimestamp: res.ecgTimestamp ?? undefined,
        ecgHeartRateBpm: res.ecgFeatures?.estimatedEcgBpm ?? undefined,
        signalQuality: res.signalQuality,
        anomalyStatus: res.anomalyStatus,
        anomalyScore: res.anomalyScore,
        alertLevel: res.alertLevel,
        contributingFeatures: res.contributingFeatures?.slice(0, 8),
        persistenceCount: res.persistenceCount,
        modelVersion: res.modelVersion ?? undefined,
        source: res.source,
        mlEngine: res.mlEngine,
        explanation: res.explanation.slice(0, VALIDATION_LIMITS.MAX_EXPLANATION_LEN),
        createdAt: res.receivedAt,
      };

      if (res.baselineProgress) {
        try {
          const bStatus = await fetchPatientBaselineStatus(
            targetPatient.patientId,
            systemSettings.baselineMinSamples
          );
          setBaselineStatusSummary(bStatus);
        } catch {
          // Non-fatal
        }
      }

      if (hasFirestoreWorkspace && user) {
        try {
          const readingDoc: Record<string, unknown> = {
            readingId,
            patientId: targetPatient.patientId,
            ownerUid: targetPatient.ownerUid,
            heartRate: newReading.heartRate,
            spo2: newReading.spo2,
            temperatureC: newReading.temperatureC,
            movementStatus: newReading.movementStatus,
            accelMagnitude: newReading.accelMagnitude,
            gyroMagnitude: newReading.gyroMagnitude,
            possibleFallDetected: Boolean(newReading.possibleFallDetected),
            signalQuality: newReading.signalQuality,
            anomalyScore: newReading.anomalyScore,
            alertLevel: newReading.alertLevel,
            source: newReading.source,
            mlEngine: newReading.mlEngine,
            explanation: newReading.explanation,
            createdAt: serverTimestamp(),
          };
          if (newReading.anomalyStatus) {
            readingDoc.anomalyStatus = newReading.anomalyStatus;
          }
          if (Array.isArray(newReading.contributingFeatures)) {
            readingDoc.contributingFeatures = newReading.contributingFeatures.slice(0, 8);
          }
          if (typeof newReading.persistenceCount === "number") {
            readingDoc.persistenceCount = Math.max(0, Math.round(newReading.persistenceCount));
          }
          if (newReading.modelVersion) {
            readingDoc.modelVersion = newReading.modelVersion.slice(0, 80);
          }
          if (boundedEcg && boundedEcg.length > 0) {
            readingDoc.ecgSamples = boundedEcg;
            readingDoc.ecgSamplingRate = newReading.ecgSamplingRate ?? 200;
            readingDoc.ecgSignalQuality = newReading.ecgSignalQuality ?? "good";
            readingDoc.ecgLeadOff = Boolean(newReading.ecgLeadOff);
            if (newReading.ecgTimestamp) {
              readingDoc.ecgTimestamp = newReading.ecgTimestamp.slice(0, 60);
            }
            if (typeof newReading.ecgHeartRateBpm === "number") {
              readingDoc.ecgHeartRateBpm = newReading.ecgHeartRateBpm;
            }
          } else if (newReading.ecgLeadOff) {
            readingDoc.ecgLeadOff = true;
            readingDoc.ecgSignalQuality = "lead_off";
          }
          if (targetPatient.primaryCaregiverUid) {
            readingDoc.primaryCaregiverUid = targetPatient.primaryCaregiverUid;
          }
          if (targetPatient.secondaryCaregiverUid) {
            readingDoc.secondaryCaregiverUid = targetPatient.secondaryCaregiverUid;
          }
          await setDoc(doc(db, "patients", targetPatient.patientId, "readings", readingId), readingDoc);

          if (newReading.alertLevel === "Warning" || newReading.alertLevel === "Critical") {
            const alertId = `al_${Date.now()}`;
            const callStatus: CallEscalationStatus =
              newReading.alertLevel === "Critical" ? "provider_unconfigured" : "not_triggered";
            const alertDoc: Record<string, unknown> = {
              alertId,
              patientId: targetPatient.patientId,
              ownerUid: targetPatient.ownerUid,
              level: newReading.alertLevel,
              status: "active",
              title: `${newReading.alertLevel} wearable reading detected (${res.triggeredMetrics.join(", ") || "Deviation"})`.slice(
                0,
                VALIDATION_LIMITS.MAX_TITLE_LEN
              ),
              explanation: newReading.explanation.slice(0, VALIDATION_LIMITS.MAX_ALERT_EXPLANATION_LEN),
              triggeredMetrics: res.triggeredMetrics.slice(0, 8),
              source: newReading.source,
              callEscalationStatus: callStatus,
              callLog: [
                `${res.receivedAt} — ${newReading.alertLevel} alert recorded from ${newReading.source}.`,
              ],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (targetPatient.primaryCaregiverUid) {
              alertDoc.primaryCaregiverUid = targetPatient.primaryCaregiverUid;
            }
            if (targetPatient.secondaryCaregiverUid) {
              alertDoc.secondaryCaregiverUid = targetPatient.secondaryCaregiverUid;
            }
            await setDoc(doc(db, "patients", targetPatient.patientId, "alerts", alertId), alertDoc);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `patients/${targetPatient.patientId}/readings`);
        }
      } else {
        setSampleReadingsMap((prev) => ({
          ...prev,
          [targetPatient.patientId]: [...(prev[targetPatient.patientId] ?? []), newReading].slice(-40),
        }));
        if (newReading.alertLevel === "Warning" || newReading.alertLevel === "Critical") {
          const newAlert: AlertRecord = {
            alertId: `al_${Date.now()}`,
            patientId: targetPatient.patientId,
            ownerUid: targetPatient.ownerUid,
            level: newReading.alertLevel,
            status: "active",
            title: `${newReading.alertLevel} simulator reading (${res.triggeredMetrics.join(", ") || "Deviation"})`,
            explanation: newReading.explanation,
            triggeredMetrics: res.triggeredMetrics.slice(0, 8),
            source: newReading.source,
            callEscalationStatus:
              newReading.alertLevel === "Critical" ? "provider_unconfigured" : "not_triggered",
            callLog: [`${res.receivedAt} — ${newReading.alertLevel} alert generated from simulator.`],
            createdAt: res.receivedAt,
            updatedAt: res.receivedAt,
          };
          setSampleAlerts((prev) => [newAlert, ...prev]);
        }
      }

      return newReading;
    },
    [selectedPatient, devices, hasFirestoreWorkspace, user, systemSettings]
  );

  const fitBaselineForSelectedPatient = useCallback(async () => {
    const cleanFilter = (r: VitalReading): r is VitalReading & { heartRate: number; spo2: number } =>
      r.signalQuality === "good" &&
      typeof r.heartRate === "number" &&
      typeof r.spo2 === "number";

    const hwClean = readings.filter((r) => r.source === "esp32_hardware").filter(cleanFilter);
    const simClean = readings.filter((r) => r.source === "simulator").filter(cleanFilter);

    let chosenSource: TelemetrySource = "simulator";
    let chosenList = simClean;
    if (hwClean.length >= 5) {
      chosenSource = "esp32_hardware";
      chosenList = hwClean;
    } else if (simClean.length < 5) {
      throw new Error(
        "Personalized baseline learning excludes sample_demo records. Collect at least 5 quality-filtered simulator packets or live ESP32 hardware packets first."
      );
    }

    const cleanSamples = chosenList.map((r) => ({
      heartRate: r.heartRate,
      spo2: r.spo2,
      temperatureC: r.temperatureC,
      accelMagnitude: r.accelMagnitude ?? 1.0,
      gyroMagnitude: r.gyroMagnitude ?? 3.0,
      movementStatus: r.movementStatus,
      signalQuality: r.signalQuality,
      timestamp: r.createdAt,
      ecgBpm: r.ecgHeartRateBpm ?? null,
      ecgSignalQuality: r.ecgSignalQuality ?? "unavailable",
      ecgLeadOff: Boolean(r.ecgLeadOff),
    }));

    const result = await requestBaselineFit(selectedPatient.patientId, cleanSamples, {
      source: chosenSource,
      minSamples: systemSettings.baselineMinSamples,
    });
    const nextStatus = result.baselineStatus;

    try {
      const bStatus = await fetchPatientBaselineStatus(
        selectedPatient.patientId,
        systemSettings.baselineMinSamples
      );
      setBaselineStatusSummary(bStatus);
    } catch {
      // Non-fatal
    }

    if (hasFirestoreWorkspace && user) {
      try {
        const updatePayload: Record<string, unknown> = {
          baselineStatus: nextStatus,
          baselineSamplesCount: result.sampleCount,
          baselineHeartRateMean: result.means.heartRate,
          baselineSpo2Mean: result.means.spo2,
          baselineTempMean: result.means.temperatureC,
          baselineSource: result.source,
          baselineModelTrained: result.trained,
          baselineModelVersion: result.modelVersion.slice(0, 80),
          updatedAt: serverTimestamp(),
        };
        if (typeof result.ecgBpmMean === "number") {
          updatePayload.baselineEcgBpmMean = result.ecgBpmMean;
        }
        if (typeof result.activeHeartRateMean === "number") {
          updatePayload.baselineActiveHrMean = result.activeHeartRateMean;
        }
        await updateDoc(doc(db, "patients", selectedPatient.patientId), updatePayload);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `patients/${selectedPatient.patientId}`);
      }
    } else {
      setSamplePatients((prev) =>
        prev.map((p) =>
          p.patientId === selectedPatient.patientId
            ? {
                ...p,
                baselineStatus: nextStatus,
                baselineSamplesCount: result.sampleCount,
                baselineHeartRateMean: result.means.heartRate,
                baselineSpo2Mean: result.means.spo2,
                baselineTempMean: result.means.temperatureC,
                baselineSource: result.source,
                baselineModelTrained: result.trained,
                baselineModelVersion: result.modelVersion,
                baselineEcgBpmMean: result.ecgBpmMean ?? p.baselineEcgBpmMean,
                baselineActiveHrMean: result.activeHeartRateMean ?? p.baselineActiveHrMean,
              }
            : p
        )
      );
    }

    return { message: result.message, mlServiceConnected: result.mlServiceConnected };
  }, [readings, selectedPatient.patientId, systemSettings.baselineMinSamples, hasFirestoreWorkspace, user]);

  const acknowledgeAlert = useCallback(
    async (alertId: string, followUpAction: string) => {
      const cleanNote = followUpAction.trim().slice(0, VALIDATION_LIMITS.MAX_FOLLOWUP_LEN);
      const ackName = (user?.displayName || "Caregiver On Duty").slice(0, VALIDATION_LIMITS.MAX_NAME_LEN);
      const ackUid = user?.uid || "demo_caregiver";

      if (hasFirestoreWorkspace && user) {
        try {
          const target = alerts.find((a) => a.alertId === alertId);
          const patientId = target?.patientId ?? selectedPatient.patientId;
          await updateDoc(doc(db, "patients", patientId, "alerts", alertId), {
            status: "acknowledged",
            acknowledgedByUid: ackUid,
            acknowledgedByName: ackName,
            followUpAction: cleanNote || "Alert acknowledged by caregiver.",
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `alerts/${alertId}`);
        }
      } else {
        setSampleAlerts((prev) =>
          prev.map((a) =>
            a.alertId === alertId
              ? {
                  ...a,
                  status: "acknowledged",
                  acknowledgedByUid: ackUid,
                  acknowledgedByName: ackName,
                  followUpAction: cleanNote || "Alert acknowledged by caregiver.",
                  updatedAt: new Date().toISOString(),
                }
              : a
          )
        );
      }
    },
    [user, hasFirestoreWorkspace, alerts, selectedPatient.patientId]
  );

  const resolveAlert = useCallback(
    async (alertId: string, followUpAction: string) => {
      const cleanNote = followUpAction.trim().slice(0, VALIDATION_LIMITS.MAX_FOLLOWUP_LEN);
      const ackName = (user?.displayName || "Caregiver On Duty").slice(0, VALIDATION_LIMITS.MAX_NAME_LEN);
      const ackUid = user?.uid || "demo_caregiver";

      if (hasFirestoreWorkspace && user) {
        try {
          const target = alerts.find((a) => a.alertId === alertId);
          const patientId = target?.patientId ?? selectedPatient.patientId;
          await updateDoc(doc(db, "patients", patientId, "alerts", alertId), {
            status: "resolved",
            acknowledgedByUid: ackUid,
            acknowledgedByName: ackName,
            followUpAction: cleanNote || "Follow-up completed and alert resolved.",
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `alerts/${alertId}`);
        }
      } else {
        setSampleAlerts((prev) =>
          prev.map((a) =>
            a.alertId === alertId
              ? {
                  ...a,
                  status: "resolved",
                  acknowledgedByUid: ackUid,
                  acknowledgedByName: ackName,
                  followUpAction: cleanNote || "Follow-up completed and alert resolved.",
                  updatedAt: new Date().toISOString(),
                }
              : a
          )
        );
      }
    },
    [user, hasFirestoreWorkspace, alerts, selectedPatient.patientId]
  );

  const updateAlertEscalation = useCallback(
    async (alertId: string, status: CallEscalationStatus, newLogEntries: string[]) => {
      const boundedLog = newLogEntries.slice(-12);
      if (hasFirestoreWorkspace && user) {
        try {
          const target = alerts.find((a) => a.alertId === alertId);
          const patientId = target?.patientId ?? selectedPatient.patientId;
          await updateDoc(doc(db, "patients", patientId, "alerts", alertId), {
            callEscalationStatus: status,
            callLog: boundedLog,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `alerts/${alertId}`);
        }
      } else {
        setSampleAlerts((prev) =>
          prev.map((a) =>
            a.alertId === alertId
              ? {
                  ...a,
                  callEscalationStatus: status,
                  callLog: boundedLog,
                  updatedAt: new Date().toISOString(),
                }
              : a
          )
        );
      }
    },
    [hasFirestoreWorkspace, user, alerts, selectedPatient.patientId]
  );

  const saveDeviceConfig = useCallback(
    async (input: {
      deviceId: string;
      label: string;
      pulseOxChipVariant: string;
      ecgSensor?: string;
      tempSensor: string;
      samplingIntervalMs: number;
      firmwareVersion: string;
    }) => {
      const safeId = sanitizeId(input.deviceId, "esp32");
      const ecgVal = (input.ecgSensor || "AD8232 Provisional ECG (ADC1 + LO+/LO-)").slice(0, 60);
      if (hasFirestoreWorkspace && user) {
        try {
          const existing = firestoreDevices.find((d) => d.deviceId === safeId);
          if (existing) {
            await updateDoc(doc(db, "devices", safeId), {
              label: input.label.slice(0, 100),
              pulseOxChipVariant: input.pulseOxChipVariant.slice(0, 60),
              ecgSensor: ecgVal,
              tempSensor: input.tempSensor.slice(0, 60),
              samplingIntervalMs: Math.max(250, Math.min(60000, Math.round(input.samplingIntervalMs))),
              firmwareVersion: input.firmwareVersion.slice(0, 40),
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, "devices", safeId), {
              deviceId: safeId,
              label: input.label.slice(0, 100),
              patientId: selectedPatient.patientId,
              ownerUid: selectedPatient.ownerUid,
              boardType: "ESP32 DevKit v1 (Wi-Fi)",
              pulseOxChipVariant: input.pulseOxChipVariant.slice(0, 60),
              ecgSensor: ecgVal,
              imuSensor: "MPU6050 6-Axis IMU",
              tempSensor: input.tempSensor.slice(0, 60),
              displayModule: "0.96-inch SSD1306 I2C OLED (128x64)",
              hapticModule: "Vibration Motor (Transistor/MOSFET Driver)",
              samplingIntervalMs: Math.max(250, Math.min(60000, Math.round(input.samplingIntervalMs))),
              connectionStatus: "not_connected",
              firmwareVersion: input.firmwareVersion.slice(0, 40),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `devices/${safeId}`);
        }
      } else {
        setSampleDevices((prev) => {
          const idx = prev.findIndex((d) => d.deviceId === safeId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...input, ecgSensor: ecgVal, updatedAt: new Date().toISOString() };
            return copy;
          }
          return [
            ...prev,
            {
              deviceId: safeId,
              label: input.label,
              patientId: selectedPatient.patientId,
              ownerUid: selectedPatient.ownerUid,
              boardType: "ESP32 DevKit v1 (Wi-Fi)",
              pulseOxChipVariant: input.pulseOxChipVariant,
              ecgSensor: ecgVal,
              imuSensor: "MPU6050 6-Axis IMU",
              tempSensor: input.tempSensor,
              displayModule: "0.96-inch SSD1306 I2C OLED (128x64)",
              hapticModule: "Vibration Motor (Transistor/MOSFET Driver)",
              samplingIntervalMs: input.samplingIntervalMs,
              connectionStatus: "not_connected",
              firmwareVersion: input.firmwareVersion,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        });
      }
    },
    [hasFirestoreWorkspace, user, firestoreDevices, selectedPatient]
  );

  const addCareLink = useCallback(
    async (input: {
      caregiverName: string;
      caregiverUid: string;
      priority: "primary" | "secondary";
    }) => {
      const linkId = sanitizeId(`link_${Date.now()}`, "link");
      const cgUid = sanitizeId(input.caregiverUid, "cg");
      const cgName = input.caregiverName.trim().slice(0, VALIDATION_LIMITS.MAX_NAME_LEN) || "Caregiver";

      if (hasFirestoreWorkspace && user) {
        try {
          await setDoc(doc(db, "careLinks", linkId), {
            linkId,
            patientId: selectedPatient.patientId,
            patientName: selectedPatient.displayName.slice(0, VALIDATION_LIMITS.MAX_NAME_LEN),
            patientOwnerUid: selectedPatient.ownerUid,
            caregiverUid: cgUid,
            caregiverName: cgName,
            priority: input.priority,
            status: "active",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `careLinks/${linkId}`);
        }
      } else {
        setSampleCareLinks((prev) => [
          ...prev,
          {
            linkId,
            patientId: selectedPatient.patientId,
            patientName: selectedPatient.displayName,
            patientOwnerUid: selectedPatient.ownerUid,
            caregiverUid: cgUid,
            caregiverName: cgName,
            priority: input.priority,
            status: "active",
          },
        ]);
      }
    },
    [hasFirestoreWorkspace, user, selectedPatient]
  );

  const updateSystemSettings = useCallback(
    async (next: {
      escalationTimeoutSec: number;
      baselineMinSamples: number;
      samplingDefaultMs: number;
      warningPersistenceWindows?: number;
      criticalPersistenceWindows?: number;
      anomalyScoreThreshold?: number;
    }) => {
      const clamped = {
        settingId: "global",
        escalationTimeoutSec: Math.max(10, Math.min(600, Math.round(next.escalationTimeoutSec))),
        baselineMinSamples: Math.max(5, Math.min(5000, Math.round(next.baselineMinSamples))),
        samplingDefaultMs: Math.max(500, Math.min(60000, Math.round(next.samplingDefaultMs))),
        warningPersistenceWindows: Math.max(
          1,
          Math.min(10, Math.round(next.warningPersistenceWindows ?? systemSettings.warningPersistenceWindows ?? 2))
        ),
        criticalPersistenceWindows: Math.max(
          1,
          Math.min(15, Math.round(next.criticalPersistenceWindows ?? systemSettings.criticalPersistenceWindows ?? 3))
        ),
        anomalyScoreThreshold: Math.max(
          -1.0,
          Math.min(0.5, Number(next.anomalyScoreThreshold ?? systemSettings.anomalyScoreThreshold ?? -0.05))
        ),
      };

      if (user && isAdminUser) {
        try {
          await setDoc(doc(db, "systemSettings", "global"), {
            ...clamped,
            updatedByUid: user.uid,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, "systemSettings/global");
        }
      } else {
        setSystemSettings({
          ...clamped,
          updatedByUid: user?.uid ?? "demo_admin_preview",
          updatedAt: new Date().toISOString(),
        });
      }
    },
    [user, isAdminUser, systemSettings]
  );

  return (
    <SmartCareContext.Provider
      value={{
        authReady,
        firestoreConnected,
        user,
        isAdminUser,
        activeRole,
        setActiveRole,
        signInWithGoogle,
        signOutUser,
        authError,
        usingSampleData,
        hasFirestoreWorkspace,
        initializeFirestoreWorkspace,
        patients,
        selectedPatientId: selectedPatient.patientId,
        setSelectedPatientId,
        selectedPatient,
        readings,
        alerts,
        devices,
        careLinks,
        registeredUsers,
        liveHardwareSnapshot,
        ecgSegments,
        baselineStatusSummary,
        systemSettings,
        integrations,
        refreshIntegrations,
        injectSimulatorReading,
        fitBaselineForSelectedPatient,
        acknowledgeAlert,
        resolveAlert,
        updateAlertEscalation,
        saveDeviceConfig,
        addCareLink,
        updateSystemSettings,
      }}
    >
      {children}
    </SmartCareContext.Provider>
  );
}

export function useSmartCare(): SmartCareContextValue {
  const ctx = useContext(SmartCareContext);
  if (!ctx) {
    throw new Error("useSmartCare must be used inside SmartCareProvider.");
  }
  return ctx;
}
