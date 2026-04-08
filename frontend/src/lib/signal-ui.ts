import { TradingSignalConfidence, TradingSignalKind } from '../types';

export function signalBadgeClass(signal: TradingSignalKind): string {
  if (signal === 'BUY') {
    return 'bg-green-500/20 border-green-500 text-green-300';
  }

  if (signal === 'SELL') {
    return 'bg-red-500/20 border-red-500 text-red-300';
  }

  return 'bg-gray-500/20 border-gray-500 text-gray-300';
}

export function confidenceBadgeClass(confidence: TradingSignalConfidence): string {
  if (confidence === 'HIGH') {
    return 'bg-green-500/20 border-green-500 text-green-300';
  }

  if (confidence === 'MEDIUM') {
    return 'bg-amber-500/20 border-amber-500 text-amber-300';
  }

  return 'bg-gray-500/20 border-gray-500 text-gray-300';
}

export function signalLabel(signal: TradingSignalKind, confidence: TradingSignalConfidence): string {
  if (signal === 'HOLD') {
    return 'HOLD';
  }

  return `${signal} ${confidence}`;
}
