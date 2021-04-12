import io from 'socket.io-client';

export default function () {
  function toastIt(rs, onClosed = () => null) {
    console.log(rs);
    if (rs.message) window.toast.success({ title: rs.message, onClosed });
  }

  window.auth.onAuthStateChanged(async (fUser) => {
    if (window.socket) window.socket.disconnect();
    if (!fUser) return;

    window.socket = io('https://miakapi3.cloud.usp-3.fr/', {
      auth: {
        uid: fUser.uid,
        token: await window.auth.currentUser.getIdToken(true),
      },
    });

    window.socket.once('logged', (rs) => {
      toastIt(rs);
    });

    window.socket.once('error', (rs) => {
      window.toast.error({ title: rs.message });
    });
  });

  return {
  };
}
