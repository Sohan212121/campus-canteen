import { ConfirmView } from "./confirm-view";

interface ConfirmPageProps {
  searchParams: Promise<{
    token_hash?: string;
    code?: string;
    type?: string;
    next?: string;
    error?: string;
    error_code?: string;
    error_description?: string;
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
      initialError={params.error_code || params.error}
      initialErrorDescription={params.error_description}
    />
  );
}
