import {
  datetime,
  longtext,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

export const lawTable = mysqlTable("law", {
  myId: varchar("myId", { length: 255 }),
  title: text("title"),
  content: longtext("content"),
  url: varchar("url", { length: 255 }),
  time: text("time"),
  insertTime: datetime("insertTime"),
  type: varchar("type", { length: 255 }),
});
