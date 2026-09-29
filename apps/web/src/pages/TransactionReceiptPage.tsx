import { Link, useParams } from 'react-router-dom';
import { INCOME_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '@hyssop/contracts';
import {
  Banner,
  EmptyState,
  LoadingBlock,
  PageHeader,
  Panel,
  SECONDARY_BUTTON_CLASS,
} from '../components/ui';
import {
  describeTransactionFailure,
  useTransactionReceipt,
} from '../features/transactions/transaction-api';
import { formatBusinessDate, formatInr, formatIstTimestamp } from '../lib/money';

/**
 * The printable receipt for one income transaction.
 *
 * Authority: `REQ-DOC-010` to `REQ-DOC-014` and `docs/01-REQUIREMENTS.md`: the receipt is
 * generated from persisted transaction data, carries the church name, the reference, the exact
 * amount, the date, the payment method, and the contributor where one legitimately exists, and
 * is marked voided rather than withheld once the record is voided.
 *
 * The receipt is a projection, not a stored artifact. Nothing is printed that the API did not
 * send, and there is deliberately no field that could name a donor for an anonymous donation —
 * `receivedFrom` is `null` there and the contract has no alternative identity field, so the
 * privacy rule cannot be violated by a later edit to this screen.
 */
export function TransactionReceiptPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const receipt = useTransactionReceipt(transactionId);

  if (receipt.isPending) {
    return <LoadingBlock label="Preparing receipt…" />;
  }

  if (receipt.isError) {
    const failure = describeTransactionFailure(receipt.error);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Receipt"
          description="The receipt could not be generated."
          action={<BackToTransactionLink />}
        />
        {receipt.error !== null && isNotFound(failure.errorMessage) ? (
          <EmptyState
            title="No receipt for this transaction"
            description="A receipt is available for income that was recorded. Expenses and records that do not exist have no receipt."
          />
        ) : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            void receipt.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const data = receipt.data;

  if (data === undefined) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Receipt ${data.referenceId}`}
        description={`Generated from the stored record on ${formatIstTimestamp(data.issuedAt)}.`}
        action={
          <div className="flex flex-wrap gap-2">
            <BackToTransactionLink />
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => {
                window.print();
              }}
            >
              Print receipt
            </button>
          </div>
        }
      />

      {data.status === 'VOIDED' ? (
        <Banner tone="warning">
          This receipt is marked VOIDED. The income it documents is kept for audit and is not
          counted in any total.
        </Banner>
      ) : null}

      <Panel title={data.applicationName}>
        {/* `break-inside-avoid` keeps the receipt whole when printed, and the white-on-white
            print styles keep a printed copy legible. The layout is a definition list because
            every line is a labelled value rather than free text. */}
        <dl className="space-y-3" style={{ breakInside: 'avoid' }}>
          <ReceiptRow label="Receipt number" value={data.referenceId} />
          <ReceiptRow label="Amount received" value={formatInr(data.amount)} emphasis />
          <ReceiptRow label="Currency" value={data.currency} />
          <ReceiptRow label="Income type" value={INCOME_TYPE_LABELS[data.incomeType]} />
          <ReceiptRow label="Business date" value={formatBusinessDate(data.businessDate)} />
          <ReceiptRow label="Payment method" value={PAYMENT_METHOD_LABELS[data.paymentMethod]} />
          <ReceiptRow
            label="Received from"
            // An anonymous donation shows "Not recorded" rather than an empty line, so the
            // receipt is not mistaken for an incomplete document.
            value={
              data.receivedFrom === null
                ? 'Not recorded (anonymous)'
                : `${data.receivedFrom.name} (${data.receivedFrom.referenceId})`
            }
          />
          <ReceiptRow label="Status" value={data.status === 'ACTIVE' ? 'Active' : 'VOIDED'} />
          {data.voidedAt === null ? null : (
            <ReceiptRow label="Voided on" value={formatIstTimestamp(data.voidedAt)} />
          )}
          {data.voidReason === null ? null : (
            <ReceiptRow label="Void reason" value={data.voidReason} />
          )}
        </dl>

        <p className="mt-6 border-t border-border-default pt-4 text-supporting text-text-secondary">
          This receipt is generated from the transaction record and is not a stored file. If the
          record is corrected, this receipt changes with it.
        </p>
      </Panel>
    </div>
  );
}

function BackToTransactionLink() {
  return (
    <Link
      to="/income"
      className="inline-block rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-text-primary hover:bg-surface-subtle"
    >
      Back to income
    </Link>
  );
}

function ReceiptRow({
  label,
  value,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean | undefined;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="text-supporting text-text-secondary">{label}</dt>
      <dd
        className={`text-supporting ${emphasis ? 'text-section-title font-bold text-text-primary' : 'font-semibold text-text-primary'}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Whether the API said the record is not there, rather than that the request failed. */
function isNotFound(message: string | undefined): boolean {
  return message !== undefined && message.toLowerCase().includes('not found');
}
