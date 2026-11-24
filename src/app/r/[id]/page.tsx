import { DetailView } from "@/components/detail-view";

export default async function ReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // `/r/<id>?part=<part>` is where a search for parts leads: the reference, with that part open.
  const { part } = await searchParams;
  return <DetailView id={id} part={typeof part === "string" ? part : undefined} />;
}
