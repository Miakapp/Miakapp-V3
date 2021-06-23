import sha256 from './sha256';

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export default async () => {
  let publicKey = '';
  for (let i = 0; i < 64; i += 1) publicKey += chars[Math.floor(Math.random() * chars.length)];

  const privateKey = sha256(publicKey);

  return { private: privateKey, public: publicKey };
};
