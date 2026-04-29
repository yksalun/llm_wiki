import { describe, expect, it, vi } from "vitest";

import { createLawDbConfigFromEnv } from "../law-db/config";
import {
  listLawSourceRecords,
  mapLawRowToSourceRecord,
} from "../law-db/repo";

describe("law db repo", () => {
  it("maps law table rows to source records without sourceHtml", () => {
    const result = mapLawRowToSourceRecord({
      myId: "abc123",
      title: "中华人民共和国统计法(2024修正)",
      content: "第一条 为了科学、有效地组织统计工作...",
      url: "http://example.test/law",
      time: "2024-09-13",
      insertTime: new Date("2026-04-24T10:37:52.000Z"),
      type: null,
    });

    expect(result).toEqual({
      myId: "abc123",
      title: "中华人民共和国统计法(2024修正)",
      content: "第一条 为了科学、有效地组织统计工作...",
      url: "http://example.test/law",
      lawTime: "2024-09-13",
      insertTime: "2026-04-24T10:37:52.000Z",
      type: null,
    });
  });

  it("requires all law db connection environment variables except port", () => {
    expect(() =>
      createLawDbConfigFromEnv({
        LAW_DB_HOST: "127.0.0.1",
        LAW_DB_DATABASE: "aifood",
        LAW_DB_USER: "root",
      }),
    ).toThrow("法规数据库配置不完整");
  });

  it("uses a Drizzle-like database to list non-empty content records", async () => {
    const where = vi.fn(async () => [
      {
        myId: "abc123",
        title: "统计法",
        content: "正文",
        url: "http://example.test/a",
        time: "2024-09-13",
        insertTime: "2026-04-24 10:37:52",
        type: "law",
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const records = await listLawSourceRecords({
      select,
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      {
        myId: "abc123",
        title: "统计法",
        content: "正文",
        url: "http://example.test/a",
        lawTime: "2024-09-13",
        insertTime: "2026-04-24 10:37:52",
        type: "law",
      },
    ]);
  });
});
