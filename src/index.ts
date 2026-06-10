import { definePlugin, PluginKind, type Subject, type SubjectBackend, type SubjectListParams, type SubjectStatus } from "@launchapp-dev/animus-plugin-sdk";

const NAME = "animus-subject-clojars-artifacts";
const VERSION = "0.1.0";
const SUBJECT_KIND = "clojars.artifact";
const DEFAULT_BASE_URL = "https://clojars.org";
const SEARCH_PAGE_SIZE = 24;

interface Config {
  baseUrl: string;
  page: number;
  limit: number;
  query: string;
  group?: string;
  license?: string;
  localQuery?: string;
}

interface ClojarsSearchArtifact {
  created?: string | number;
  description?: string;
  group_name?: string;
  jar_name?: string;
  version?: string;
}

interface ClojarsSearchResponse {
  count?: number;
  offset?: number;
  "results-per-page"?: number;
  "total-hits"?: number;
  results?: ClojarsSearchArtifact[];
}

interface ClojarsLicense {
  name?: string;
  url?: string;
}

interface ClojarsScm {
  connection?: string;
  "developer-connection"?: string;
  tag?: string;
  url?: string;
  [key: string]: string | undefined;
}

interface ClojarsVersion {
  version?: string;
  downloads?: number;
}

interface ClojarsDependency {
  group_name?: string;
  jar_name?: string;
  version?: string;
  scope?: string;
}

interface ClojarsArtifact extends ClojarsSearchArtifact {
  downloads?: number;
  homepage?: string;
  scm?: ClojarsScm;
  latest_version?: string;
  latest_release?: string;
  licenses?: ClojarsLicense[];
  recent_versions?: ClojarsVersion[];
  user?: string;
  dependencies?: ClojarsDependency[];
  [key: string]: unknown;
}

interface ListCursor {
  page: number;
  index: number;
}

interface SearchMeta {
  count?: number;
  offset?: number;
  page?: number;
  totalHits?: number;
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === "" ? undefined : raw;
}

function normalizeBaseUrl(raw: string | undefined, fallback: string): string {
  return (raw ?? fallback).replace(/\/+$/, "");
}

function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function readConfig(): Config {
  return {
    baseUrl: normalizeBaseUrl(optionalEnv("CLOJARS_BASE_URL") ?? optionalEnv("CLOJARS_API_URL"), DEFAULT_BASE_URL),
    page: readPositiveInt(optionalEnv("CLOJARS_PAGE"), 1, 10_000),
    limit: readPositiveInt(optionalEnv("CLOJARS_LIMIT"), SEARCH_PAGE_SIZE, 100),
    query: optionalEnv("CLOJARS_QUERY") ?? "ring",
    group: optionalEnv("CLOJARS_GROUP"),
    license: optionalEnv("CLOJARS_LICENSE"),
    localQuery: optionalEnv("CLOJARS_LOCAL_QUERY"),
  };
}

function normalized(value: string | number | undefined | null, maxLength = 80): string | undefined {
  const label = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return label ? label.slice(0, maxLength) : undefined;
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string): string {
  return decodeURIComponent(value);
}

function groupName(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name">): string {
  return String(artifact.group_name ?? artifact.jar_name ?? "").trim();
}

function jarName(artifact: Pick<ClojarsArtifact, "jar_name" | "group_name">): string {
  return String(artifact.jar_name ?? artifact.group_name ?? "").trim();
}

function validateCoordinatePart(label: string, value: string): string {
  const part = value.trim();
  if (!part || /[\s/]/.test(part)) throw new Error(`expected Clojars ${label}, got '${value}'`);
  return part;
}

function artifactCoordinate(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name"> | string): string {
  if (typeof artifact === "string") {
    const coordinate = decodePart(artifact).trim();
    const parts = coordinate.split("/");
    if (parts.length === 1) {
      const jar = validateCoordinatePart("artifact", parts[0] ?? "");
      return `${jar}/${jar}`;
    }
    if (parts.length !== 2) throw new Error(`expected Clojars coordinate '<group>/<artifact>', got '${artifact}'`);
    return `${validateCoordinatePart("group", parts[0] ?? "")}/${validateCoordinatePart("artifact", parts[1] ?? "")}`;
  }
  return `${validateCoordinatePart("group", groupName(artifact))}/${validateCoordinatePart("artifact", jarName(artifact))}`;
}

function artifactSubjectId(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name"> | string): string {
  return `${SUBJECT_KIND}:${encodePart(artifactCoordinate(artifact))}`;
}

function parseArtifactSubjectId(id: string): string {
  const raw = id.startsWith(`${SUBJECT_KIND}:`) ? id.slice(`${SUBJECT_KIND}:`.length) : id;
  return artifactCoordinate(decodePart(raw));
}

function coordinateParts(coordinate: string): { group: string; artifact: string } {
  const [group, artifact] = artifactCoordinate(coordinate).split("/");
  return { group: group as string, artifact: artifact as string };
}

function toIso(value: string | number | null | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  const numeric = Number(raw);
  const millis = Number.isFinite(numeric) && /^\d+$/.test(raw) ? numeric : Date.parse(raw);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function artifactVersion(artifact: Pick<ClojarsArtifact, "latest_version" | "latest_release" | "version">): string | undefined {
  return artifact.latest_version ?? artifact.latest_release ?? artifact.version;
}

function artifactTitle(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name">): string {
  const coordinate = artifactCoordinate(artifact);
  const { group, artifact: jar } = coordinateParts(coordinate);
  return group === jar ? jar : coordinate;
}

function artifactUrl(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name"> | string, baseUrl = DEFAULT_BASE_URL): string {
  const { group, artifact: jar } = coordinateParts(typeof artifact === "string" ? artifact : artifactCoordinate(artifact));
  return `${baseUrl.replace(/\/+$/, "")}/${encodePart(group)}/${encodePart(jar)}`;
}

function apiUrl(artifact: Pick<ClojarsArtifact, "group_name" | "jar_name"> | string, baseUrl = DEFAULT_BASE_URL): string {
  const { group, artifact: jar } = coordinateParts(typeof artifact === "string" ? artifact : artifactCoordinate(artifact));
  return `${baseUrl.replace(/\/+$/, "")}/api/artifacts/${encodePart(group)}/${encodePart(jar)}`;
}

function nativeStatus(artifact: ClojarsArtifact): string {
  const version = artifactVersion(artifact);
  if (!version) return "empty";
  return /snapshot/i.test(version) ? "snapshot" : "active";
}

function statusFromArtifact(artifact: ClojarsArtifact): SubjectStatus {
  const status = nativeStatus(artifact);
  if (status === "empty") return "blocked";
  if (status === "snapshot") return "in-progress";
  return "done";
}

function priorityFromArtifact(artifact: ClojarsArtifact): number {
  const downloads = artifact.downloads ?? 0;
  if (downloads >= 10_000_000) return 2;
  if (downloads >= 1_000_000) return 3;
  if (downloads >= 100_000) return 4;
  return 5;
}

function labelsFromArtifact(artifact: ClojarsArtifact): string[] {
  const labels = new Set<string>(["clojars", "artifact", nativeStatus(artifact)]);
  const coordinate = artifactCoordinate(artifact);
  const { group, artifact: jar } = coordinateParts(coordinate);
  const groupLabel = normalized(group);
  const artifactLabel = normalized(jar);
  const major = artifactVersion(artifact)?.match(/^(\d+)\./)?.[1];
  if (groupLabel) labels.add(`group:${groupLabel}`);
  if (artifactLabel) labels.add(`artifact:${artifactLabel}`);
  if (major) labels.add(`major:${major}`);
  for (const license of artifact.licenses ?? []) {
    const label = normalized(license.name);
    if (label) labels.add(`license:${label}`);
  }
  const user = normalized(artifact.user);
  if (user) labels.add(`user:${user}`);
  if (artifact.homepage) labels.add("has-homepage");
  if (artifact.scm?.url) labels.add("has-scm");
  if (artifact.homepage?.includes("github.com") || artifact.scm?.url?.includes("github.com")) labels.add("github-source");
  if ((artifact.dependencies?.length ?? 0) > 0) labels.add("has-dependencies");
  return [...labels];
}

function subjectFromArtifact(artifact: ClojarsArtifact, fetchedAt = new Date().toISOString(), meta: SearchMeta = {}): Subject {
  const coordinate = artifactCoordinate(artifact);
  const version = artifactVersion(artifact);
  const createdAt = toIso(artifact.created) ?? fetchedAt;
  const updatedAt = artifact.latest_version || artifact.latest_release ? fetchedAt : createdAt;
  const description = artifact.description ? `${coordinate}: ${artifact.description}` : `Clojars artifact ${coordinate}`;
  return {
    id: artifactSubjectId(coordinate),
    kind: SUBJECT_KIND,
    title: artifactTitle(artifact),
    description,
    status: statusFromArtifact(artifact),
    created_at: createdAt,
    updated_at: updatedAt,
    labels: labelsFromArtifact(artifact),
    assignee: artifact.user,
    url: artifactUrl(coordinate),
    native_status: nativeStatus(artifact),
    priority: priorityFromArtifact(artifact),
    custom: {
      coordinate,
      group_name: coordinateParts(coordinate).group,
      jar_name: coordinateParts(coordinate).artifact,
      version,
      latest_version: artifact.latest_version,
      latest_release: artifact.latest_release,
      downloads: artifact.downloads,
      homepage: artifact.homepage,
      scm: artifact.scm ?? {},
      licenses: artifact.licenses ?? [],
      user: artifact.user,
      dependencies: artifact.dependencies ?? [],
      dependencies_count: artifact.dependencies?.length ?? 0,
      recent_versions: artifact.recent_versions ?? [],
      recent_versions_count: artifact.recent_versions?.length ?? 0,
      api_url: apiUrl(coordinate),
      search_count: meta.count,
      search_offset: meta.offset,
      search_page: meta.page,
      search_total_hits: meta.totalHits,
      raw: artifact,
    },
  };
}

function matchesConfiguredFilters(config: Config, artifact: ClojarsArtifact): boolean {
  const coordinate = artifactCoordinate(artifact);
  const { group } = coordinateParts(coordinate);
  if (config.group && group !== config.group) return false;
  if (config.license && !(artifact.licenses ?? []).some((license) => license.name === config.license)) return false;
  if (!config.localQuery) return true;
  const needle = config.localQuery.toLowerCase();
  const haystack = [
    coordinate,
    artifact.description,
    artifactVersion(artifact),
    artifact.homepage,
    artifact.scm?.url,
    artifact.user,
    ...(artifact.licenses ?? []).flatMap((license) => [license.name, license.url]),
    ...(artifact.dependencies ?? []).flatMap((dep) => [dep.group_name, dep.jar_name, dep.version, dep.scope]),
    ...(artifact.recent_versions ?? []).flatMap((version) => [version.version, version.downloads]),
  ].join(" ").toLowerCase();
  return haystack.includes(needle);
}

function matchesFilters(config: Config, artifact: ClojarsArtifact, params: SubjectListParams): boolean {
  if (!matchesConfiguredFilters(config, artifact)) return false;
  const subject = subjectFromArtifact(artifact);
  if (params.status && params.status.length > 0 && !params.status.includes(subject.status)) return false;
  if (params.assignee && params.assignee.length > 0 && (!subject.assignee || !params.assignee.includes(subject.assignee))) return false;
  const labels = new Set(subject.labels ?? []);
  if (params.labels_all && !params.labels_all.every((label) => labels.has(label))) return false;
  if (params.labels_any && params.labels_any.length > 0 && !params.labels_any.some((label) => labels.has(label))) return false;
  if (params.updated_since && new Date(subject.updated_at) < new Date(params.updated_since)) return false;
  return true;
}

function listLimit(params: SubjectListParams, fallback: number): number {
  const value = params.limit;
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.trunc(value), 100);
}

function parseCursor(cursor: string | undefined, fallbackPage: number): ListCursor {
  if (!cursor) return { page: fallbackPage, index: 0 };
  const [pageRaw, indexRaw] = cursor.split(":");
  const page = Number.parseInt(pageRaw ?? "", 10);
  const index = Number.parseInt(indexRaw ?? "0", 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : fallbackPage,
    index: Number.isFinite(index) && index >= 0 ? index : 0,
  };
}

function formatCursor(cursor: ListCursor): string {
  return `${cursor.page}:${cursor.index}`;
}

class ClojarsArtifactsClient {
  constructor(private readonly config: Config) {}

  async requestJson<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `${NAME}/${VERSION} (https://github.com/launchapp-dev/${NAME}; mailto:opensource@launchapp.dev)`,
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Clojars API ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    return JSON.parse(text) as T;
  }

  async search(page: number): Promise<ClojarsSearchResponse> {
    return this.requestJson<ClojarsSearchResponse>("/search", { q: this.config.query, format: "json", page });
  }

  async get(coordinate: string): Promise<ClojarsArtifact> {
    const { group, artifact } = coordinateParts(coordinate);
    return this.requestJson<ClojarsArtifact>(`/api/artifacts/${encodePart(group)}/${encodePart(artifact)}`);
  }
}

function hasNextPage(response: ClojarsSearchResponse): boolean {
  const count = response.count ?? response.results?.length ?? 0;
  const offset = response.offset ?? 0;
  const total = response["total-hits"] ?? count;
  return offset + count < total;
}

function buildBackend(): SubjectBackend {
  let cached: { client: ClojarsArtifactsClient; config: Config } | null = null;
  const runtime = (): { client: ClojarsArtifactsClient; config: Config } => {
    if (!cached) {
      const config = readConfig();
      cached = { client: new ClojarsArtifactsClient(config), config };
    }
    return cached;
  };
  return {
    async list(params) {
      const { client, config } = runtime();
      const limit = listLimit(params, config.limit);
      let { page, index } = parseCursor(params.cursor, config.page);
      const subjects: Subject[] = [];
      let nextCursor: string | null = null;
      const fetchedAt = new Date().toISOString();

      for (let scannedPages = 0; scannedPages < 10 && subjects.length < limit; scannedPages += 1) {
        const response = await client.search(page);
        const meta = {
          count: response.count,
          offset: response.offset,
          page,
          totalHits: response["total-hits"],
        };
        const filtered = (response.results ?? []).map((artifact) => artifact as ClojarsArtifact).filter((artifact) => matchesFilters(config, artifact, params));
        for (let i = index; i < filtered.length && subjects.length < limit; i += 1) {
          subjects.push(subjectFromArtifact(filtered[i] as ClojarsArtifact, fetchedAt, meta));
          nextCursor = i + 1 < filtered.length ? formatCursor({ page, index: i + 1 }) : null;
        }
        if (subjects.length >= limit) {
          if (nextCursor === null && hasNextPage(response)) nextCursor = formatCursor({ page: page + 1, index: 0 });
          break;
        }
        if (!hasNextPage(response)) {
          nextCursor = null;
          break;
        }
        page += 1;
        index = 0;
        nextCursor = formatCursor({ page, index: 0 });
      }

      return {
        subjects,
        next_cursor: nextCursor,
        fetched_at: fetchedAt,
      };
    },
    async get(params) {
      const { client } = runtime();
      return subjectFromArtifact(await client.get(parseArtifactSubjectId(params.id)));
    },
    schema() {
      return {
        kinds: [SUBJECT_KIND],
        status_values: ["ready", "in-progress", "blocked", "done", "cancelled"],
        supports_watch: false,
        supports_create: false,
        supports_pagination: true,
        native_status_values: ["active", "snapshot", "empty"],
        status_dispatch_hints: [
          { native_status: "active", status: "done" },
          { native_status: "snapshot", status: "in-progress" },
          { native_status: "empty", status: "blocked" },
        ],
        custom_fields: [
          "coordinate",
          "group_name",
          "jar_name",
          "version",
          "latest_version",
          "latest_release",
          "downloads",
          "homepage",
          "scm",
          "licenses",
          "user",
          "dependencies",
          "dependencies_count",
          "recent_versions",
          "recent_versions_count",
          "api_url",
          "search_count",
          "search_offset",
          "search_page",
          "search_total_hits",
          "raw",
        ],
      };
    },
    async health() {
      try {
        const { client } = runtime();
        await client.get("ring/ring-core");
        return { status: "healthy", uptime_ms: null, memory_usage_bytes: null, last_error: null };
      } catch (err) {
        return { status: "unhealthy", uptime_ms: null, memory_usage_bytes: null, last_error: String(err) };
      }
    },
  };
}

export {
  ClojarsArtifactsClient,
  artifactCoordinate,
  artifactSubjectId,
  artifactTitle,
  artifactUrl,
  artifactVersion,
  formatCursor,
  labelsFromArtifact,
  listLimit,
  matchesConfiguredFilters,
  matchesFilters,
  nativeStatus,
  parseArtifactSubjectId,
  parseCursor,
  priorityFromArtifact,
  statusFromArtifact,
  subjectFromArtifact,
  toIso,
};

export type {
  ClojarsArtifact,
  ClojarsDependency,
  ClojarsLicense,
  ClojarsScm,
  ClojarsSearchArtifact,
  ClojarsSearchResponse,
  ClojarsVersion,
  Config,
  ListCursor,
};

const plugin = definePlugin({
  kind: PluginKind.SubjectBackend,
  name: NAME,
  version: VERSION,
  description: "Clojars artifact metadata subject backend plugin for Animus",
  subject_kinds: [SUBJECT_KIND],
  env_required: [
    { name: "CLOJARS_BASE_URL", description: `Optional Clojars base URL. Defaults to ${DEFAULT_BASE_URL}.`, required: false },
    { name: "CLOJARS_API_URL", description: `Deprecated alias for CLOJARS_BASE_URL. Defaults to ${DEFAULT_BASE_URL}.`, required: false },
    { name: "CLOJARS_QUERY", description: "Artifact search query for list requests. Defaults to ring.", required: false },
    { name: "CLOJARS_PAGE", description: "Optional starting search results page. Defaults to 1.", required: false },
    { name: "CLOJARS_LIMIT", description: "Optional maximum artifact count from 1 to 100. Defaults to 24.", required: false },
    { name: "CLOJARS_GROUP", description: "Optional exact Clojars group filter applied after search.", required: false },
    { name: "CLOJARS_LICENSE", description: "Optional exact license-name filter applied after search, such as The MIT License.", required: false },
    { name: "CLOJARS_LOCAL_QUERY", description: "Optional local text query applied to artifact, dependency, SCM, license, user, and version fields.", required: false },
  ],
  impl: buildBackend(),
});

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("index.cjs") || entry.endsWith("index.js") || entry.endsWith(NAME);
}

if (isDirectRun()) {
  plugin.run().catch((err) => {
    process.stderr.write(`[${NAME}] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
