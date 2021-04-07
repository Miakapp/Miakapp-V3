import io from 'socket.io-client';

export default function () {
  function toastIt(rs, onClosed = () => null) {
    console.log(rs);
    if (rs.message) window.toast.success({ title: rs.message, onClosed });
  }

  return {
    login(auth) {
      if (window.socket) window.socket.disconnect();

      window.socket = io('https://miakapi3.cloud.usp-3.fr/', { auth });

      window.socket.once('logged', (rs) => {
        toastIt(rs);
      });

      window.socket.once('error', (rs) => {
        window.toast.error({ title: rs.message });
      });
    },
  };
}
