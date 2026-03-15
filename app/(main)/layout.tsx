import Navbar from "@/components/Navbar";
import ProviderManager from "@/components/ProviderManager";
import { getUserId } from "@/lib/auth";
import { getJobsMatch } from "@/lib/data-services";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getUserId();

  const jobs = await getJobsMatch();

  let fit = 0;
  let notFit = 0;

  if (jobs) {
    fit = jobs?.filter((j) => {
      return j.fit === true && j.applied !== true && j.interested_in !== false;
    }).length;
    notFit = jobs?.filter((j) => {
      return j.fit === false;
    }).length;
  }

  return (
    <ProviderManager>
      <Navbar fit={fit} notFit={notFit} />
      {children}
    </ProviderManager>
  );
}
