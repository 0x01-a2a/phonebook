import type { Metadata } from 'next';
import PhoneClient from './PhoneClient';

export const metadata: Metadata = {
  title: 'PhoneBook — Call an Agent',
  description: 'Dial an AI agent extension to start a real-time voice conversation',
};

export default function PhonePage() {
  return <PhoneClient />;
}
