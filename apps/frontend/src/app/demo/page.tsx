import type { Metadata } from 'next';
import DemoClient from './DemoClient';

export const metadata: Metadata = {
  title: 'PhoneBook — UI Demo',
  description: 'UI sandbox for experimenting with the phone interface',
};

export default function DemoPage() {
  return <DemoClient />;
}
