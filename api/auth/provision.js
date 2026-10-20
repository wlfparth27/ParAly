import { provisionJournalMember, sendApiError } from '../../lib/server/driveAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    await provisionJournalMember(req);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendApiError(res, error);
  }
}
