"use client";

import {
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  History,
  KeyRound,
  Loader2,
  Mic,
  RefreshCcw,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type {
  AppLedgerRecord,
  ImportRequest,
  ImportResult,
  ProviderMode,
  PublicProfile,
  SanitizedLookiMoment,
} from "@/src/app-types";
import type { RuntimeStatus } from "@/src/server/status";

type SelectionState = Record<
  string,
  { importMemory: boolean; importConversation: boolean }
>;

interface ApiProfileResponse {
  profile: PublicProfile | null;
}

interface ApiMomentsResponse {
  moments: SanitizedLookiMoment[];
}

interface ApiImportResponse {
  result: ImportResult;
  workflowRunId?: string;
  workflowTriggerError?: string;
}

interface ApiLedgerResponse {
  ledger: AppLedgerRecord[];
}

export function BridgeApp() {
  const [uid, setUid] = useState("");
  const [date, setDate] = useState(localDate());
  const [lookiBaseUrl, setLookiBaseUrl] = useState(
    "https://open.looki.ai/api/v1",
  );
  const [lookiApiKey, setLookiApiKey] = useState("");
  const [providerMode, setProviderMode] = useState<ProviderMode>("managed");
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [moments, setMoments] = useState<SanitizedLookiMoment[]>([]);
  const [selection, setSelection] = useState<SelectionState>({});
  const [ledger, setLedger] = useState<AppLedgerRecord[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlUid = params.get("uid");
    if (urlUid) setUid(urlUid);
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!uid.trim()) return;
    void refreshProfile(uid.trim());
    void refreshLedger(uid.trim());
  }, [uid]);

  const selectedCount = useMemo(
    () =>
      Object.values(selection).filter(
        (item) => item.importMemory || item.importConversation,
      ).length,
    [selection],
  );
  const hasActiveJobs = useMemo(
    () =>
      ledger.some(
        (entry) =>
          entry.record.status === "queued" ||
          entry.record.status === "processing",
      ),
    [ledger],
  );

  useEffect(() => {
    if (!uid.trim() || !hasActiveJobs) return;
    const timer = window.setInterval(() => {
      void refreshLedger(uid.trim());
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, uid]);

  async function refreshStatus() {
    setStatus(await api<RuntimeStatus>("/api/status"));
  }

  async function refreshProfile(nextUid: string) {
    try {
      const response = await api<ApiProfileResponse>(
        `/api/profile?uid=${encodeURIComponent(nextUid)}`,
      );
      setProfile(response.profile);
      if (response.profile) {
        setLookiBaseUrl(response.profile.lookiBaseUrl);
        setProviderMode(response.profile.providerMode);
      }
    } catch {
      setProfile(null);
    }
  }

  async function refreshLedger(nextUid = uid.trim()) {
    if (!nextUid) return;
    try {
      const response = await api<ApiLedgerResponse>(
        `/api/ledger?uid=${encodeURIComponent(nextUid)}`,
      );
      setLedger(response.ledger);
    } catch {
      setLedger([]);
    }
  }

  async function saveProfile() {
    await run("profile", async () => {
      const response = await api<ApiProfileResponse>("/api/profile", {
        method: "POST",
        body: JSON.stringify({
          uid,
          lookiBaseUrl,
          lookiApiKey,
          providerMode,
        }),
      });
      setProfile(response.profile);
      setLookiApiKey("");
    });
  }

  async function loadMoments() {
    await run("moments", async () => {
      const response = await api<ApiMomentsResponse>(
        `/api/moments?uid=${encodeURIComponent(uid.trim())}&date=${encodeURIComponent(date)}`,
      );
      setMoments(response.moments);
      setSelection(
        Object.fromEntries(
          response.moments.map((moment) => [
            moment.id,
            defaultSelection(moment),
          ]),
        ),
      );
      setResult(null);
    });
  }

  async function importSelected() {
    const selections: ImportRequest["selections"] = Object.entries(selection)
      .filter(([, item]) => item.importMemory || item.importConversation)
      .map(([momentId, item]) => ({ momentId, ...item }));
    await run("import", async () => {
      const response = await api<ApiImportResponse>("/api/import", {
        method: "POST",
        body: JSON.stringify({ uid, date, selections }),
      });
      setResult(response.result);
      if (response.workflowTriggerError) {
        setError(
          `导入已入队，但 Vercel Workflow 启动失败：${response.workflowTriggerError}`,
        );
      }
      await refreshLedger();
    });
  }

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Omi App Connector</p>
          <h1>Looki Omi Bridge</h1>
        </div>
        <div className="status-strip">
          <StatusPill label="Omi" ok={Boolean(status?.omiConfigured)} />
          <StatusPill label="ASR" ok={Boolean(status?.asrConfigured)} />
          <StatusPill
            label="LLM"
            ok={Boolean(status?.llmConfigured)}
            muted={!status?.llmConfigured}
          />
          <span className="pill neutral">
            <Database size={15} />
            {status?.store || "file"}
          </span>
        </div>
      </section>

      <section className="workspace">
        <aside className="setup-panel">
          <PanelTitle icon={<Settings2 size={18} />} title="连接" />
          <label>
            Omi UID
            <input
              value={uid}
              onChange={(event) => setUid(event.target.value)}
              placeholder="uid"
            />
          </label>
          <label>
            Looki Base URL
            <input
              value={lookiBaseUrl}
              onChange={(event) => setLookiBaseUrl(event.target.value)}
            />
          </label>
          <label>
            Looki API Key
            <input
              value={lookiApiKey}
              onChange={(event) => setLookiApiKey(event.target.value)}
              placeholder={profile ? "已保存，留空则沿用" : "粘贴 API key"}
              type="password"
            />
          </label>
          <label>
            Provider
            <select
              value={providerMode}
              onChange={(event) =>
                setProviderMode(event.target.value as ProviderMode)
              }
            >
              <option value="managed">managed</option>
              <option value="user_key" disabled>
                user_key
              </option>
              <option value="subscription" disabled>
                subscription
              </option>
            </select>
          </label>
          <button
            className="primary"
            disabled={!uid || busy === "profile"}
            onClick={saveProfile}
          >
            {busy === "profile" ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <KeyRound size={17} />
            )}
            保存连接
          </button>
          {profile ? (
            <p className="fine-print">
              已连接：{profile.lookiBaseUrl}
              <br />
              更新：{formatDateTime(profile.updatedAt)}
            </p>
          ) : (
            <p className="fine-print">
              连接信息只保存在服务端存储，页面不会回显 API key。
            </p>
          )}
        </aside>

        <section className="main-panel">
          <div className="toolbar">
            <label className="date-field">
              <CalendarDays size={17} />
              <input
                value={date}
                onChange={(event) => setDate(event.target.value)}
                type="date"
              />
            </label>
            <button disabled={!uid || busy === "moments"} onClick={loadMoments}>
              {busy === "moments" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <RefreshCcw size={17} />
              )}
              读取 Looki
            </button>
            <button
              className="primary"
              disabled={!selectedCount || busy === "import"}
              onClick={importSelected}
            >
              {busy === "import" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <UploadCloud size={17} />
              )}
              导入选中
            </button>
            <span className="count">{selectedCount} selected</span>
          </div>

          {error ? (
            <div className="notice error">
              <AlertTriangle size={18} />
              {error}
            </div>
          ) : null}

          {hasActiveJobs ? (
            <div className="notice info">
              <Loader2 className="spin" size={18} />
              后台导入处理中，右侧 Ledger 会持续更新阶段和失败原因。
            </div>
          ) : null}

          <div className="moment-list">
            {moments.length === 0 ? (
              <EmptyState />
            ) : (
              moments.map((moment) => (
                <MomentRow
                  key={moment.id}
                  moment={moment}
                  value={selection[moment.id] || defaultSelection(moment)}
                  onChange={(next) =>
                    setSelection((current) => ({
                      ...current,
                      [moment.id]: next,
                    }))
                  }
                />
              ))
            )}
          </div>

          {result ? <ResultPanel result={result} /> : null}
        </section>

        <aside className="ledger-panel">
          <div className="ledger-title">
            <PanelTitle icon={<History size={18} />} title="Ledger" />
            <button
              className="icon-button"
              disabled={!uid}
              onClick={() => void refreshLedger()}
            >
              <RefreshCcw size={16} />
            </button>
          </div>
          <div className="ledger-list">
            {ledger.length === 0 ? (
              <p className="fine-print">暂无记录。</p>
            ) : (
              ledger.map((entry) => (
                <LedgerRow
                  key={`${entry.uid}:${entry.record.idempotencyKey}`}
                  entry={entry}
                />
              ))
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function MomentRow({
  moment,
  value,
  onChange,
}: {
  moment: SanitizedLookiMoment;
  value: { importMemory: boolean; importConversation: boolean };
  onChange: (next: {
    importMemory: boolean;
    importConversation: boolean;
  }) => void;
}) {
  const hasAudio = moment.mediaTypes.includes("AUDIO");
  return (
    <article className="moment-row">
      <div className="moment-main">
        <div className="moment-time">
          <Clock3 size={15} />
          {shortTime(moment.startTime)} - {shortTime(moment.endTime)}
        </div>
        <h2>{moment.title}</h2>
        {moment.description ? <p>{moment.description}</p> : null}
        <div className="tag-row">
          {moment.mediaTypes.map((type) => (
            <span key={type} className="tag">
              {type}
            </span>
          ))}
        </div>
      </div>
      <div className="moment-actions">
        <label className="toggle">
          <input
            checked={value.importMemory}
            onChange={(event) =>
              onChange({ ...value, importMemory: event.target.checked })
            }
            type="checkbox"
          />
          <Brain size={16} />
          Memory
        </label>
        <label className="toggle">
          <input
            checked={value.importConversation}
            disabled={!hasAudio}
            onChange={(event) =>
              onChange({ ...value, importConversation: event.target.checked })
            }
            type="checkbox"
          />
          <Mic size={16} />
          录音会话
        </label>
      </div>
    </article>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  return (
    <section className="result-panel">
      <PanelTitle icon={<CheckCircle2 size={18} />} title="结果" />
      <div className="result-grid">
        {result.items.map((item, index) => (
          <div
            key={`${item.momentId}:${item.target}:${index}`}
            className={`result-item ${item.status}`}
          >
            <span>{item.target}</span>
            <strong>{item.status}</strong>
            <small>
              {item.reason ||
                item.omiId ||
                item.candidate?.headline ||
                item.transcript?.text.slice(0, 40)}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function LedgerRow({ entry }: { entry: AppLedgerRecord }) {
  const progress =
    entry.record.error?.message || entry.record.progress?.message;
  return (
    <div className="ledger-row">
      <div>
        <strong>
          {entry.record.looki.title || entry.record.looki.momentId}
        </strong>
        <span>
          {entry.record.target}
          {entry.record.progress?.stage
            ? ` · ${entry.record.progress.stage}`
            : ""}
        </span>
        {progress ? <p className="ledger-progress">{progress}</p> : null}
      </div>
      <div className="ledger-meta">
        <span className={`mini-status ${entry.record.status}`}>
          {entry.record.status}
        </span>
        <time>{formatDateTime(entry.record.updatedAt)}</time>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  ok,
  muted,
}: {
  label: string;
  ok: boolean;
  muted?: boolean;
}) {
  return (
    <span className={`pill ${ok ? "ok" : muted ? "muted" : "warn"}`}>
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      {label}
    </span>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <CalendarDays size={28} />
      <p>选择日期后读取 Looki moments。</p>
    </div>
  );
}

function defaultSelection(moment: SanitizedLookiMoment) {
  return {
    importMemory: true,
    importConversation: moment.mediaTypes.includes("AUDIO"),
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload as T;
}

function localDate(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
