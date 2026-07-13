import 'dotenv/config';
import axios from 'axios';
import { config } from '../src/config';

async function main(): Promise<void> {
  const v2 = axios.create({
    baseURL: config.holdedApiBaseUrl,
    headers: { Authorization: `Bearer ${config.holdedApiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const resp = await v2.post('/documents/convert', {
    source_type: 'salesorder',
    source_id: '6a52bd7ee27567d9f20ba367',
    target_type: 'waybill',
    approveDoc: true,
  });
  console.log('Convert OK:', JSON.stringify(resp.data));
  const id = resp.data.id;
  const resp2 = await v2.get(`/waybills/${id}`);
  console.log('draft =', resp2.data.draft, '| document_number =', resp2.data.document_number);
}
main();
