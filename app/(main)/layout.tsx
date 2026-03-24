import Navbar from "@/components/Navbar";
import ProviderManager from "@/components/ProviderManager";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getUserId();

  let fit = 0;
  let notFit = 0;

  if (userId) {
    const [{ count: fitCount }, { count: notFitCount }] = await Promise.all([
      supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("fit", true)
        .eq("user_id", userId)
        .or("applied.is.null,applied.eq.false")
        .or("interested_in.is.null,interested_in.eq.true"),
      supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("fit", false)
        .eq("user_id", userId),
    ]);
    fit = fitCount ?? 0;
    notFit = notFitCount ?? 0;
  }

  return (
    <ProviderManager>
      <Navbar fit={fit} notFit={notFit} />
      {children}
    </ProviderManager>
  );
}
