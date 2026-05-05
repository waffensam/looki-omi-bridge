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
  Sparkles,
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
  SanitizedLookiForYouHint,
  SanitizedLookiForYouItem,
  SanitizedLookiMoment,
} from "@/src/app-types";
import type { ImportStatus, ImportTarget } from "@/src/contracts";
import type { RuntimeStatus } from "@/src/server/status";

type ImportMode = "audio" | "memory";
type BooleanSelectionState = Record<string, boolean>;
type LookiSourceType = "moment" | "for_you";
type UidSource = "url" | "stored" | "manual" | null;

const LAST_UID_STORAGE_KEY = "looki-omi-bridge:last-omi-uid";

interface ItemImportStatus {
  status: ImportStatus;
  target: ImportTarget;
  label: string;
  detail?: string;
  disabled: boolean;
  retryable: boolean;
  updatedAt: string;
}

type ItemStatusMap = Record<string, ItemImportStatus | undefined>;

interface ApiProfileResponse {
  profile: PublicProfile | null;
}

interface ApiMomentsResponse {
  moments: SanitizedLookiMoment[];
  forYouItems: SanitizedLookiForYouItem[];
  forYouError?: string;
}

interface ApiImportResponse {
  result: ImportResult;
  workflowRunId?: string;
  workflowTriggerError?: string;
}

interface ApiLedgerResponse {
  ledger: AppLedgerRecord[];
  usage?: MonthlyAsrUsageSummary;
}

interface MonthlyAsrUsageSummary {
  month: string;
  asrRunCount: number;
  originalDurationMs: number;
  billableSpeechMs: number;
  estimatedCostUsd: number;
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
  const [forYouItems, setForYouItems] = useState<SanitizedLookiForYouItem[]>(
    [],
  );
  const [mode, setMode] = useState<ImportMode>("audio");
  const [audioSelection, setAudioSelection] = useState<BooleanSelectionState>(
    {},
  );
  const [memorySelection, setMemorySelection] = useState<BooleanSelectionState>(
    {},
  );
  const [ledger, setLedger] = useState<AppLedgerRecord[]>([]);
  const [usage, setUsage] = useState<MonthlyAsrUsageSummary | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uidSource, setUidSource] = useState<UidSource>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlUid = params.get("uid")?.trim();
    const oauthState = params.get("state")?.trim();
    if (urlUid && oauthState && !params.get("omi_connected")) {
      const callbackUrl = new URL(
        "/api/oauth/callback",
        window.location.origin,
      );
      callbackUrl.searchParams.set("uid", urlUid);
      callbackUrl.searchParams.set("state", oauthState);
      window.location.replace(callbackUrl.toString());
      return;
    }
    if (urlUid) {
      setUid(urlUid);
      setUidSource("url");
      rememberLastUid(urlUid);
      removeUidFromUrl();
    } else {
      const storedUid = readLastUid();
      if (storedUid) {
        setUid(storedUid);
        setUidSource("stored");
      }
    }
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!uid.trim()) return;
    void refreshProfile(uid.trim());
    void refreshLedger(uid.trim());
  }, [uid]);

  const audioMoments = useMemo(
    () => moments.filter((moment) => moment.mediaTypes.includes("AUDIO")),
    [moments],
  );
  const audioStatusBySource = useMemo(
    () => buildImportStatusMap(ledger, "conversation"),
    [ledger],
  );
  const memoryStatusBySource = useMemo(
    () => buildImportStatusMap(ledger, "memory"),
    [ledger],
  );
  const audioSelectedCount = useMemo(
    () =>
      Object.entries(audioSelection).filter(
        ([momentId, selected]) =>
          selected &&
          !isSelectionLocked(
            audioStatusBySource[sourceStatusKey("moment", momentId)],
          ),
      ).length,
    [audioSelection, audioStatusBySource],
  );
  const memorySelectedCount = useMemo(
    () =>
      Object.entries(memorySelection).filter(
        ([key, selected]) =>
          selected && !isSelectionLocked(memoryStatusBySource[key]),
      ).length,
    [memorySelection, memoryStatusBySource],
  );
  const memoryCandidateCount = forYouItems.length + moments.length;
  const hasLoadedLooki = moments.length > 0 || forYouItems.length > 0;
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
      const response = await fetchLedger(nextUid);
      setLedger(response.ledger);
      setUsage(response.usage || null);
    } catch {
      setLedger([]);
      setUsage(null);
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
      rememberLastUid(response.profile?.uid || uid.trim());
      setUidSource("stored");
    });
  }

  async function loadMoments() {
    await run("moments", async () => {
      const nextUid = uid.trim();
      const [response, nextLedger] = await Promise.all([
        api<ApiMomentsResponse>(
          `/api/moments?uid=${encodeURIComponent(nextUid)}&date=${encodeURIComponent(date)}`,
        ),
        fetchLedger(nextUid).catch((): ApiLedgerResponse => ({ ledger: [] })),
      ]);
      const nextAudioStatus = buildImportStatusMap(
        nextLedger.ledger,
        "conversation",
      );
      const nextMemoryStatus = buildImportStatusMap(
        nextLedger.ledger,
        "memory",
      );
      setMoments(response.moments);
      setForYouItems(response.forYouItems || []);
      setLedger(nextLedger.ledger);
      setUsage(nextLedger.usage || null);
      if (response.forYouError) {
        setError(`For You 读取失败，已仅返回 moments：${response.forYouError}`);
      }
      setAudioSelection(
        Object.fromEntries(
          response.moments
            .filter((moment) => moment.mediaTypes.includes("AUDIO"))
            .map((moment) => [
              moment.id,
              canDefaultSelectItem(
                nextAudioStatus[sourceStatusKey("moment", moment.id)],
              ),
            ]),
        ),
      );
      setMemorySelection(
        Object.fromEntries([
          ...(response.forYouItems || []).map((item) => [
            memorySourceKey("for_you", item.id),
            !isDayContextForYou(item) &&
              canDefaultSelectItem(
                nextMemoryStatus[sourceStatusKey("for_you", item.id)],
              ),
          ]),
          ...response.moments.map((moment) => [
            memorySourceKey("moment", moment.id),
            false,
          ]),
        ] as Array<[string, boolean]>),
      );
      setResult(null);
    });
  }

  async function importSelected() {
    const selections: ImportRequest["selections"] =
      mode === "audio"
        ? Object.entries(audioSelection)
            .filter(
              ([momentId, selected]) =>
                selected &&
                !isSelectionLocked(
                  audioStatusBySource[sourceStatusKey("moment", momentId)],
                ),
            )
            .map(([momentId]) => ({
              sourceType: "moment",
              sourceId: momentId,
              momentId,
              importMemory: false,
              importConversation: true,
            }))
        : Object.entries(memorySelection)
            .filter(
              ([key, selected]) =>
                selected && !isSelectionLocked(memoryStatusBySource[key]),
            )
            .map(([key]) => {
              const source = parseMemorySourceKey(key);
              return {
                sourceType: source.type,
                sourceId: source.id,
                ...(source.type === "moment" ? { momentId: source.id } : {}),
                importMemory: true,
                importConversation: false,
              };
            });
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
              onChange={(event) => {
                setUid(event.target.value);
                setUidSource(event.target.value.trim() ? "manual" : null);
              }}
              placeholder="uid"
            />
            {uidSource === "stored" ? (
              <span className="field-hint">
                已从本机浏览器恢复。若不是当前 Omi 账号，请替换后保存。
              </span>
            ) : null}
            {uidSource === "url" ? (
              <span className="field-hint">
                已从 Omi 打开的链接读取 UID，并已记住到本机浏览器。
              </span>
            ) : null}
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
          <p className="privacy-note">
            Looki API key 代表对 Looki 内容的读取权限。本页读取所选日期的
            moments/For You；只有导入录音时才下载临时音频。
          </p>
        </aside>

        <section className="main-panel">
          {!uid.trim() ? (
            <div className="notice setup-warning">
              <AlertTriangle size={18} />
              <div>
                <strong>缺少 Omi UID</strong>
                <span>
                  Mac 端 Open 有时只打开 App Home URL，不带用户 ID。请从 Omi
                  的授权/设置入口打开一次，或手动填入
                  UID；之后本机浏览器会自动记住。
                </span>
              </div>
              <a className="link-button" href="/api/oauth/start">
                从 Omi 授权连接
              </a>
            </div>
          ) : null}

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
            {hasLoadedLooki ? (
              <span className="count">
                读取：{audioMoments.length} 录音 · {forYouItems.length} For You
                · {moments.length} moments
              </span>
            ) : null}
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

          <ModeTabs
            audioCount={audioMoments.length}
            forYouCount={forYouItems.length}
            memoryCount={memoryCandidateCount}
            mode={mode}
            onChange={setMode}
          />

          {mode === "audio" ? (
            <AudioImportView
              busy={busy === "import"}
              moments={audioMoments}
              selectedCount={audioSelectedCount}
              selection={audioSelection}
              statusBySource={audioStatusBySource}
              onChange={(momentId, selected) => {
                if (
                  isSelectionLocked(
                    audioStatusBySource[sourceStatusKey("moment", momentId)],
                  )
                ) {
                  return;
                }
                setAudioSelection((current) => ({
                  ...current,
                  [momentId]: selected,
                }));
              }}
              onImport={importSelected}
            />
          ) : (
            <MemoryImportView
              busy={busy === "import"}
              forYouItems={forYouItems}
              moments={moments}
              selectedCount={memorySelectedCount}
              selection={memorySelection}
              statusBySource={memoryStatusBySource}
              onChange={(key, selected) => {
                if (isSelectionLocked(memoryStatusBySource[key])) return;
                setMemorySelection((current) => ({
                  ...current,
                  [key]: selected,
                }));
              }}
              onImport={importSelected}
            />
          )}

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
          {usage ? <AsrUsageSummary usage={usage} /> : null}
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

function ModeTabs({
  audioCount,
  forYouCount,
  memoryCount,
  mode,
  onChange,
}: {
  audioCount: number;
  forYouCount: number;
  memoryCount: number;
  mode: ImportMode;
  onChange: (mode: ImportMode) => void;
}) {
  return (
    <div className="mode-tabs">
      <button
        className={mode === "audio" ? "active" : ""}
        onClick={() => onChange("audio")}
      >
        <span className="tab-label">
          <Mic size={16} />
          录音导入
        </span>
        <span className="tab-count">{audioCount} 条录音</span>
      </button>
      <button
        className={mode === "memory" ? "active" : ""}
        onClick={() => onChange("memory")}
      >
        <span className="tab-label">
          <Brain size={16} />
          记忆导入
        </span>
        <span className="tab-count">
          {memoryCount} 项候选 · {forYouCount} For You
        </span>
      </button>
    </div>
  );
}

function AudioImportView({
  busy,
  moments,
  selectedCount,
  selection,
  statusBySource,
  onChange,
  onImport,
}: {
  busy: boolean;
  moments: SanitizedLookiMoment[];
  selectedCount: number;
  selection: BooleanSelectionState;
  statusBySource: ItemStatusMap;
  onChange: (momentId: string, selected: boolean) => void;
  onImport: () => void;
}) {
  return (
    <section className="import-view">
      <ViewActionBar
        busy={busy}
        detail={`${moments.length} 条录音 · 已选 ${selectedCount}`}
        label="导入录音"
        note="默认全选当天录音；For You 只作为识别录音内容的补充说明。"
        selectedCount={selectedCount}
        onImport={onImport}
      />
      <div className="moment-list">
        {moments.length === 0 ? (
          <EmptyState message="这一天没有可导入的录音 moment。" />
        ) : (
          moments.map((moment) => (
            <AudioMomentRow
              key={moment.id}
              moment={moment}
              selected={Boolean(selection[moment.id])}
              status={statusBySource[sourceStatusKey("moment", moment.id)]}
              onChange={(selected) => onChange(moment.id, selected)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MemoryImportView({
  busy,
  forYouItems,
  moments,
  selectedCount,
  selection,
  statusBySource,
  onChange,
  onImport,
}: {
  busy: boolean;
  forYouItems: SanitizedLookiForYouItem[];
  moments: SanitizedLookiMoment[];
  selectedCount: number;
  selection: BooleanSelectionState;
  statusBySource: ItemStatusMap;
  onChange: (key: string, selected: boolean) => void;
  onImport: () => void;
}) {
  return (
    <section className="import-view">
      <ViewActionBar
        busy={busy}
        detail={`${forYouItems.length} For You · ${moments.length} moments · 已选 ${selectedCount}`}
        label="导入记忆"
        note="默认勾选非当日背景的 For You；moments 默认不勾选。导入后交给 Omi 原生记忆抽取。"
        selectedCount={selectedCount}
        onImport={onImport}
      />

      <section className="candidate-section">
        <SectionTitle icon={<Sparkles size={16} />} title="For You" />
        <div className="memory-candidate-grid">
          {forYouItems.length === 0 ? (
            <EmptyState message="这一天没有 For You 内容。" />
          ) : (
            forYouItems.map((item) => {
              const key = memorySourceKey("for_you", item.id);
              return (
                <MemoryCandidateCard
                  key={key}
                  checked={Boolean(selection[key])}
                  description={item.description || item.content || ""}
                  meta={[
                    item.type,
                    isDayContextForYou(item) ? "当日背景" : "高质量线索",
                  ]}
                  status={statusBySource[key]}
                  title={item.title}
                  onChange={(selected) => onChange(key, selected)}
                />
              );
            })
          )}
        </div>
      </section>

      <section className="candidate-section">
        <SectionTitle icon={<Clock3 size={16} />} title="Moments" />
        <div className="moment-list compact">
          {moments.length === 0 ? (
            <EmptyState />
          ) : (
            moments.map((moment) => {
              const key = memorySourceKey("moment", moment.id);
              return (
                <MomentMemoryRow
                  key={key}
                  moment={moment}
                  selected={Boolean(selection[key])}
                  status={statusBySource[key]}
                  onChange={(selected) => onChange(key, selected)}
                />
              );
            })
          )}
        </div>
      </section>
    </section>
  );
}

function ViewActionBar({
  busy,
  detail,
  label,
  note,
  selectedCount,
  onImport,
}: {
  busy: boolean;
  detail: string;
  label: string;
  note: string;
  selectedCount: number;
  onImport: () => void;
}) {
  return (
    <div className="view-action-bar">
      <div>
        <p className="view-detail">{detail}</p>
        <p>{note}</p>
      </div>
      <button
        className="primary"
        disabled={!selectedCount || busy}
        onClick={onImport}
      >
        {busy ? (
          <Loader2 className="spin" size={17} />
        ) : (
          <UploadCloud size={17} />
        )}
        {label}
      </button>
    </div>
  );
}

function AudioMomentRow({
  moment,
  selected,
  status,
  onChange,
}: {
  moment: SanitizedLookiMoment;
  selected: boolean;
  status: ItemImportStatus | undefined;
  onChange: (selected: boolean) => void;
}) {
  const locked = isSelectionLocked(status);
  return (
    <article className={itemClassName("moment-row", status, selected)}>
      <label className="row-check">
        <input
          checked={selected && !locked}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      <MomentBody moment={moment} showForYouNote />
      <div className="moment-actions">
        {status ? <ItemStatusBadge status={status} /> : null}
        <span className="action-label">
          <Mic size={16} />
          录音会话
        </span>
      </div>
      {status?.detail ? <ItemStatusNote status={status} /> : null}
    </article>
  );
}

function MomentMemoryRow({
  moment,
  selected,
  status,
  onChange,
}: {
  moment: SanitizedLookiMoment;
  selected: boolean;
  status: ItemImportStatus | undefined;
  onChange: (selected: boolean) => void;
}) {
  const locked = isSelectionLocked(status);
  return (
    <article
      className={itemClassName("moment-row memory-row", status, selected)}
    >
      <label className="row-check">
        <input
          checked={selected && !locked}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      <MomentBody moment={moment} />
      <div className="moment-actions">
        {status ? <ItemStatusBadge status={status} /> : null}
        <span className="action-label">
          <Brain size={16} />
          Memory
        </span>
      </div>
      {status?.detail ? <ItemStatusNote status={status} /> : null}
    </article>
  );
}

function MomentBody({
  moment,
  showForYouNote = false,
}: {
  moment: SanitizedLookiMoment;
  showForYouNote?: boolean;
}) {
  return (
    <div className="moment-main">
      <div className="moment-time">
        <Clock3 size={15} />
        {shortTime(moment.startTime)} - {shortTime(moment.endTime)}
      </div>
      <h2>{moment.title}</h2>
      {moment.description ? <p>{moment.description}</p> : null}
      {showForYouNote && moment.forYouHints?.[0] ? (
        <ForYouNote hint={moment.forYouHints[0]} />
      ) : null}
      <div className="tag-row">
        {moment.mediaTypes.map((type) => (
          <span key={type} className="tag">
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}

function MemoryCandidateCard({
  checked,
  description,
  meta,
  status,
  title,
  onChange,
}: {
  checked: boolean;
  description: string;
  meta: string[];
  status: ItemImportStatus | undefined;
  title: string;
  onChange: (selected: boolean) => void;
}) {
  const locked = isSelectionLocked(status);
  return (
    <label className={itemClassName("memory-candidate-card", status, checked)}>
      <input
        checked={checked && !locked}
        className="candidate-checkbox"
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <div className="candidate-content">
        <strong className="candidate-title">{title}</strong>
        <div className="candidate-meta">
          {meta.map((item) => (
            <span className={candidateMetaClass(item)} key={item}>
              {item}
            </span>
          ))}
          {status ? <ItemStatusBadge status={status} /> : null}
        </div>
        {status?.detail ? <ItemStatusNote status={status} /> : null}
        <p>{description}</p>
      </div>
    </label>
  );
}

function ForYouNote({ hint }: { hint: SanitizedLookiForYouHint }) {
  return (
    <div className="for-you-note">
      <div className="for-you-note-title">
        <Sparkles size={14} />
        <span>
          {hint.role === "audio_context" ? "录音补充" : "Memory 线索"}
        </span>
        <small>{matchReasonLabel(hint.matchReason)}</small>
      </div>
      <strong>{hint.title}</strong>
      <p>{previewForYouHint(hint)}</p>
    </div>
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

function AsrUsageSummary({ usage }: { usage: MonthlyAsrUsageSummary }) {
  return (
    <div className="usage-summary">
      <span>{usage.month} ASR</span>
      <strong>{formatDurationMs(usage.billableSpeechMs)}</strong>
      <small>
        {usage.asrRunCount} 次 · 约 ${usage.estimatedCostUsd.toFixed(4)}
      </small>
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

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h3>{title}</h3>
    </div>
  );
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="empty-state">
      <CalendarDays size={28} />
      <p>{message || "选择日期后读取 Looki moments。"}</p>
    </div>
  );
}

function ItemStatusBadge({ status }: { status: ItemImportStatus }) {
  return (
    <span className={`item-status-badge ${status.status}`}>{status.label}</span>
  );
}

function ItemStatusNote({ status }: { status: ItemImportStatus }) {
  return <p className="item-status-note">{status.detail}</p>;
}

function buildImportStatusMap(
  ledger: AppLedgerRecord[],
  target: ImportTarget,
): ItemStatusMap {
  const map: ItemStatusMap = {};
  for (const entry of ledger) {
    if (entry.record.target !== target) continue;
    const sourceType = entry.record.looki.sourceType || "moment";
    const sourceId =
      sourceType === "for_you"
        ? entry.record.looki.forYouItemId || entry.record.looki.momentId
        : entry.record.looki.momentId;
    const key = sourceStatusKey(sourceType, sourceId);
    const current = map[key];
    if (
      !current ||
      entry.record.updatedAt.localeCompare(current.updatedAt) > 0
    ) {
      map[key] = ledgerEntryToItemStatus(entry);
    }
  }
  return map;
}

function ledgerEntryToItemStatus(entry: AppLedgerRecord): ItemImportStatus {
  const { record } = entry;
  const detail = itemStatusDetail(record);
  return {
    status: record.status,
    target: record.target,
    label: importStatusLabel(record.status),
    ...(detail ? { detail } : {}),
    disabled: isLockedImportStatus(record.status),
    retryable: record.status === "failed" && Boolean(record.error?.retryable),
    updatedAt: record.updatedAt,
  };
}

function itemStatusDetail(
  record: AppLedgerRecord["record"],
): string | undefined {
  if (record.error?.message) return record.error.message;
  if (record.omi?.conversationId)
    return `Omi conversation: ${record.omi.conversationId}`;
  if (record.omi?.memoryId) return `Omi memory: ${record.omi.memoryId}`;
  if (record.progress?.message) return record.progress.message;
  return undefined;
}

function importStatusLabel(status: ImportStatus): string {
  const labels: Record<ImportStatus, string> = {
    failed: "上次失败",
    imported: "已导入",
    planned: "已计划",
    processing: "处理中",
    queued: "已排队",
    skipped: "已跳过",
    transcribed: "已转写",
  };
  return labels[status];
}

function isSelectionLocked(status?: ItemImportStatus): boolean {
  return Boolean(status?.disabled);
}

function isLockedImportStatus(status: ImportStatus): boolean {
  return (
    status === "imported" ||
    status === "queued" ||
    status === "processing" ||
    status === "skipped"
  );
}

function canDefaultSelectItem(status?: ItemImportStatus): boolean {
  if (!status) return true;
  return status.status === "failed" && status.retryable;
}

function itemClassName(
  baseClassName: string,
  status: ItemImportStatus | undefined,
  selected: boolean,
): string {
  return [
    baseClassName,
    selected && !isSelectionLocked(status) ? "is-selected" : "",
    status ? `status-${status.status}` : "",
    isSelectionLocked(status) ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isDayContextForYou(item: SanitizedLookiForYouItem): boolean {
  return item.type === "DAILY_VLOG" || item.type === "USER_EVENT_ANALYSIS";
}

function candidateMetaClass(value: string): string {
  if (value === "高质量线索") return "quality";
  if (value === "当日背景") return "context";
  return "source";
}

function sourceStatusKey(type: LookiSourceType, id: string): string {
  return `${type}:${id}`;
}

function memorySourceKey(type: LookiSourceType, id: string): string {
  return sourceStatusKey(type, id);
}

function rememberLastUid(uid: string) {
  if (!uid) return;
  try {
    window.localStorage.setItem(LAST_UID_STORAGE_KEY, uid);
  } catch {
    // Some embedded browsers can block localStorage; the page still works with manual UID entry.
  }
}

function readLastUid(): string | null {
  try {
    return window.localStorage.getItem(LAST_UID_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function removeUidFromUrl() {
  const current = new URL(window.location.href);
  current.searchParams.delete("uid");
  current.searchParams.delete("state");
  current.searchParams.delete("omi_connected");
  const next = `${current.pathname}${current.search}${current.hash}`;
  window.history.replaceState(null, "", next);
}

function parseMemorySourceKey(key: string): {
  type: LookiSourceType;
  id: string;
} {
  const [type, ...rest] = key.split(":");
  if (type !== "for_you" && type !== "moment") {
    throw new Error(`Unknown memory source: ${key}`);
  }
  return { type, id: rest.join(":") };
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

async function fetchLedger(uid: string): Promise<ApiLedgerResponse> {
  return api<ApiLedgerResponse>(`/api/ledger?uid=${encodeURIComponent(uid)}`);
}

function localDate(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatDurationMs(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (durationMs > 0 && minutes === 0) return "<1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours} 小时 ${remainingMinutes} 分钟`
    : `${hours} 小时`;
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function previewForYouHint(hint: SanitizedLookiForYouHint): string {
  const text = hint.description || hint.content || "";
  if (text.length <= 180) return text;
  return `${text.slice(0, 179).trim()}...`;
}

function matchReasonLabel(reason: SanitizedLookiForYouHint["matchReason"]) {
  if (reason === "time_text") return "时间+文本";
  if (reason === "time") return "时间";
  return "文本";
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
