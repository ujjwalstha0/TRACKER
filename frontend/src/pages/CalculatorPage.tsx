import { CalculatorWidget } from '../components/CalculatorWidget';

interface CalculatorPageProps {
  tradeLocked: boolean;
}

export function CalculatorPage({ tradeLocked }: CalculatorPageProps) {
  return <CalculatorWidget tradeLocked={tradeLocked} />;
}
