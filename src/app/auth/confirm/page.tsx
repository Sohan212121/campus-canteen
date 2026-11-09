import { ConfirmView } from "./confirm-view";

interface ConfirmPageProps {
  searchParams: Promise<{
    token_hash?: string;
    code?: string;
    type?: string;
    next?: string;
  }>;
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = await searchParams;

  return (
    <ConfirmView
      initialTokenHash={params.token_hash}
      initialCode={params.code}
      initialType={params.type}
      initialNext={params.next}
    />
  );
}
