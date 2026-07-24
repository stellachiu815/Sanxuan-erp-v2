import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/system-center/version?operatorUserId=xxx
 * 需求「系統版本」子頁面：目前版本號＋已套用的 migration 清單。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  let migrations: { migration_name: string; finished_at: string | null }[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC NULLS LAST`
    );
    migrations = rows.map((r) => ({
      migration_name: r.migration_name,
      finished_at: r.finished_at ? r.finished_at.toISOString() : null,
    }));
  } catch {
    // _prisma_migrations 查不到（例如尚未執行過 migrate deploy）不影響其他版本資訊顯示。
  }

  return NextResponse.json({ version: pkg.version, name: pkg.name, description: pkg.description, migrations });
}
