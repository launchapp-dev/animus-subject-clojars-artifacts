import { describe, expect, it } from "vitest";
import {
  artifactCoordinate,
  artifactSubjectId,
  artifactTitle,
  artifactUrl,
  artifactVersion,
  formatCursor,
  labelsFromArtifact,
  matchesConfiguredFilters,
  matchesFilters,
  nativeStatus,
  parseArtifactSubjectId,
  parseCursor,
  priorityFromArtifact,
  statusFromArtifact,
  subjectFromArtifact,
  toIso,
  type ClojarsArtifact,
  type Config,
} from "./index";

const config: Config = {
  baseUrl: "https://clojars.org",
  page: 1,
  limit: 24,
  query: "ring",
};

const ringCore: ClojarsArtifact = {
  description: "Ring core libraries.",
  downloads: 39232952,
  homepage: "https://github.com/ring-clojure/ring",
  scm: {
    connection: "scm:git:git://github.com/ring-clojure/ring.git",
    "developer-connection": "scm:git:ssh://git@github.com/ring-clojure/ring.git",
    tag: "43478d1daa7f03fdbfc943304c66b32ab96b4961",
    url: "https://github.com/ring-clojure/ring",
  },
  latest_version: "1.15.4",
  latest_release: "1.15.4",
  licenses: [{ name: "The MIT License", url: "http://opensource.org/licenses/MIT" }],
  jar_name: "ring-core",
  group_name: "ring",
  recent_versions: [
    { version: "1.15.4", downloads: 41121 },
    { version: "1.15.3", downloads: 535331 },
  ],
  user: "weavejester",
  dependencies: [
    { group_name: "org.clojure", jar_name: "clojure", version: "1.9.0", scope: "compile" },
    { group_name: "ring", jar_name: "ring-codec", version: "1.3.0", scope: "compile" },
  ],
};

const ringCodecSearch: ClojarsArtifact = {
  created: "1742731334334",
  description: "Library for encoding and decoding data",
  group_name: "ring",
  jar_name: "ring-codec",
  version: "1.3.0",
};

describe("Clojars artifact helpers", () => {
  it("builds coordinates and ids", () => {
    expect(artifactCoordinate(ringCore)).toBe("ring/ring-core");
    expect(artifactCoordinate("ring-core")).toBe("ring-core/ring-core");
    expect(artifactSubjectId(ringCore)).toBe("clojars.artifact:ring%2Fring-core");
    expect(artifactSubjectId("ring/ring-core")).toBe("clojars.artifact:ring%2Fring-core");
    expect(parseArtifactSubjectId("clojars.artifact:ring%2Fring-core")).toBe("ring/ring-core");
    expect(parseArtifactSubjectId("ring%2Fring-core")).toBe("ring/ring-core");
    expect(() => parseArtifactSubjectId("clojars.artifact:not/valid/coordinate")).toThrow(/expected Clojars coordinate/);
  });

  it("maps detail records to subjects", () => {
    const subject = subjectFromArtifact(ringCore, "2026-05-30T19:45:00.000Z", { page: 1, totalHits: 873 });
    expect(subject.id).toBe("clojars.artifact:ring%2Fring-core");
    expect(subject.kind).toBe("clojars.artifact");
    expect(subject.title).toBe("ring/ring-core");
    expect(subject.status).toBe("done");
    expect(subject.native_status).toBe("active");
    expect(subject.assignee).toBe("weavejester");
    expect(subject.priority).toBe(2);
    expect(subject.created_at).toBe("2026-05-30T19:45:00.000Z");
    expect(subject.updated_at).toBe("2026-05-30T19:45:00.000Z");
    expect(subject.url).toBe("https://clojars.org/ring/ring-core");
    expect(subject.custom?.latest_version).toBe("1.15.4");
    expect(subject.custom?.downloads).toBe(39232952);
    expect(subject.custom?.dependencies_count).toBe(2);
    expect(subject.custom?.recent_versions_count).toBe(2);
    expect(subject.custom?.search_total_hits).toBe(873);
  });

  it("maps search records to subjects", () => {
    const subject = subjectFromArtifact(ringCodecSearch, "2026-05-30T19:45:00.000Z", { count: 24, offset: 0, page: 1, totalHits: 873 });
    expect(subject.id).toBe("clojars.artifact:ring%2Fring-codec");
    expect(subject.title).toBe("ring/ring-codec");
    expect(subject.status).toBe("done");
    expect(subject.created_at).toBe("2025-03-23T12:02:14.334Z");
    expect(subject.updated_at).toBe("2025-03-23T12:02:14.334Z");
    expect(subject.custom?.version).toBe("1.3.0");
    expect(subject.custom?.search_count).toBe(24);
  });

  it("extracts artifact state", () => {
    expect(toIso("1742731334334")).toBe("2025-03-23T12:02:14.334Z");
    expect(artifactVersion(ringCore)).toBe("1.15.4");
    expect(artifactTitle({ group_name: "leiningen", jar_name: "leiningen" })).toBe("leiningen");
    expect(artifactUrl(ringCore)).toBe("https://clojars.org/ring/ring-core");
    expect(nativeStatus(ringCore)).toBe("active");
    expect(nativeStatus({ ...ringCore, latest_version: "1.0.0-SNAPSHOT" })).toBe("snapshot");
    expect(statusFromArtifact({ ...ringCore, latest_version: undefined, latest_release: undefined, version: undefined })).toBe("blocked");
    expect(statusFromArtifact({ ...ringCore, latest_version: "1.0.0-SNAPSHOT" })).toBe("in-progress");
    expect(priorityFromArtifact(ringCore)).toBe(2);
    expect(priorityFromArtifact({ ...ringCore, downloads: 1000 })).toBe(5);
  });

  it("labels and filters records", () => {
    expect(labelsFromArtifact(ringCore)).toEqual([
      "clojars",
      "artifact",
      "active",
      "group:ring",
      "artifact:ring-core",
      "major:1",
      "license:the-mit-license",
      "user:weavejester",
      "has-homepage",
      "has-scm",
      "github-source",
      "has-dependencies",
    ]);
    expect(matchesConfiguredFilters({ ...config, group: "ring" }, ringCore)).toBe(true);
    expect(matchesConfiguredFilters({ ...config, group: "org.clojure" }, ringCore)).toBe(false);
    expect(matchesConfiguredFilters({ ...config, license: "The MIT License" }, ringCore)).toBe(true);
    expect(matchesConfiguredFilters({ ...config, license: "Apache-2.0" }, ringCore)).toBe(false);
    expect(matchesConfiguredFilters({ ...config, localQuery: "ring-codec" }, ringCore)).toBe(true);
    expect(matchesFilters(config, ringCore, { labels_all: ["clojars", "license:the-mit-license"] })).toBe(true);
    expect(matchesFilters(config, ringCore, { labels_any: ["artifact:reitit", "artifact:ring-core"] })).toBe(true);
    expect(matchesFilters(config, ringCore, { assignee: ["weavejester"] })).toBe(true);
  });

  it("parses list cursors", () => {
    expect(parseCursor(undefined, 1)).toEqual({ page: 1, index: 0 });
    expect(parseCursor("3:7", 1)).toEqual({ page: 3, index: 7 });
    expect(parseCursor("bad", 2)).toEqual({ page: 2, index: 0 });
    expect(formatCursor({ page: 4, index: 0 })).toBe("4:0");
  });
});
