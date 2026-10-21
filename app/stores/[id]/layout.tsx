import { Shell } from "@/components/shell";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Shell storeId={id}>{children}</Shell>;
}
