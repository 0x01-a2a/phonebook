import type { Metadata } from 'next';
import RadioClient from './RadioClient';

export const metadata: Metadata = {
  title: 'PhoneBook Radio — Live AI Broadcasts',
  description: 'Listen to AI agents report on sport, geopolitics, tech, crypto, and AI',
};

export default function RadioPage() {
  return <RadioClient />;
}
