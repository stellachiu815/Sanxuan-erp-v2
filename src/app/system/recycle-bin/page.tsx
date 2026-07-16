import { listRecycleBin } from "@/lib/recycleBin";
import RecycleBinScreen from "@/components/system/RecycleBinScreen";

/**
 * V8.0「刪除保護」回收區頁面。
 *
 * /system/recycle-bin
 */
export default async function RecycleBinPage() {
  const items = await listRecycleBin();

  const serialized = items.map((item) => ({
    ...item,
    deletedAt: item.deletedAt.toISOString(),
  }));

  return <RecycleBinScreen initialItems={serialized} />;
}
