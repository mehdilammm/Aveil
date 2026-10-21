import { redirect } from "next/navigation";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

export default async function StoresIndex() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const [first] = await listStores(supabase);
  redirect(first ? `/stores/${first.id}` : "/settings");
}
