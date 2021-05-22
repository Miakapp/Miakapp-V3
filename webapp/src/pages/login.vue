<template>
  <div class="fullpage">
    <div class="container">
      <div class="title">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 91 94"><path d="M11.073,63.127c3.313-6.224,8.636-16.205,8.997-16.752c0.525-0.797,1.154-1.724,2.94-3.299c1.786-1.576,4.451-4.308,4.451-4.308s-5.769,0.144-5.816-3.991c-0.016-1.37,1.367-5.963,3.783-10.725c2.416-4.763,11.729-14.006,11.729-14.006s-7.528,4.247-9.695,5.508c-2.166,1.26-12.854,8.613-14.01,16.387c-1.155,7.772-4.996,36.106-4.996,36.106c0,0.001,3.877,7.506,12.069,13.809c8.193,6.303,23.95,6.197,23.95,6.197l1.991-1.577c-2.739-0.423-15.545-5.674-21.424-9.978C19.818,72.674,12.617,64.833,11.073,63.127z"/><path d="M81.392,63.758c-0.508-0.897-2.702-1.154-5.194-0.695c-2.492,0.458-2.94,1.882-3.186,2.442s0.595,2.556,1.681,3.291s1.365,0.91,2.416,0.876c1.051-0.035,1.52-0.376,1.753-0.942c0.305-0.74-1.094-1.374-1.103-1.864c-0.01-0.47,1.499-0.043,1.864,0.315c0.365,0.357,0.93,1.246,0.21,2.547c-0.562,1.015-2.907,4.159-4.65,5.861c-1.506,1.471-4.973,3.676-8.475,3.711c-3.501,0.036-4.621-0.21-7.737-1.015c-2.304-0.596-7.402-3.925-9.595-5.183c-0.772-0.443-0.451,0.2-0.215,0.498c1.278,1.606,6.201,5.197,11.239,6.841c3.927,1.281,9.243,0.604,11.712-0.524c2.131-0.976,3.812-2.455,5.783-4.622c2.367-2.602,4.615-6.089,4.616-7.773C82.513,65.838,81.941,64.729,81.392,63.758z"/><path d="M69.474,46.562c-0.104,0.84,0.525,3.389,0.525,3.389s0.21-0.343,0.473-1.184c0.263-0.84,0.998-1.785,0.998-1.785s0,0-0.735-0.42S69.474,46.562,69.474,46.562z"/><path d="M73.362,11.478c0,0-7.773,6.197-8.509,8.508c-0.734,2.312,0.946,6.514,2.206,8.299c1.261,1.785,1.959,4.097,1.959,4.097s5.079-9.769,5.604-14.392C75.148,13.369,74.833,11.268,73.362,11.478z"/><path d="M25.778,33.957c0,0,2.94,0.735,4.832,0c1.891-0.734,2.626-6.092,3.886-7.878c1.262-1.786,3.992-9.349,1.892-9.559c0,0-6.198,6.197-8.089,9.559S25.778,33.957,25.778,33.957z"/><path d="M57.956,51.148c0,0-0.63-1.119-1.399-1.891c-0.77-0.77-3.012-2.17-3.012-2.17s-0.42,1.346-1.33,1.346s-1.506-0.82-1.506-0.82s-0.596-0.071-1.786,0.35c-1.19,0.42-2.696,1.295-2.696,1.295s2.731,2.767,5.322,3.432C54.139,53.355,57.956,51.148,57.956,51.148z"/><path d="M62.823,23.502c0,0-2.522-4.423,6.944-12.039c4.121-3.314,8.285-5.572,8.285-5.572s-2.73-0.315-5.042,1.051c-2.311,1.365-7.22,4.937-8.337,5.986c-1.116,1.051-6.158,0.631-8.784,4.623c0,0,1.771,0.817,3.081,1.75C60.281,20.232,62.823,23.502,62.823,23.502z"/></svg>
        <div>Miakapp - Login</div>
      </div>

      <div class="tabs anim" :class="{ hidden: forgotPass }">
        <div class="tab anim" :class="{ selected: !newAccount }"
          @click="newAccount = false">Login</div>
        <div class="tab anim" :class="{ selected: newAccount }"
          @click="newAccount = true">Sign Up</div>
      </div>

      <form class="block small" @submit="submit">
        <input type="email" v-model="email" placeholder="Email" autocomplete="email" required>

        <input type="password" placeholder="Password" :required="!forgotPass"
          :class="{ hidden: forgotPass }" v-model="password"
          :autocomplete="newAccount ? 'new-password' : 'current-password'">
        <input type="password" autocomplete="new-password" style="margin-top:0"
          placeholder="Confirm password" v-model="confirm" :required="newAccount"
          :class="{ hidden: forgotPass || !newAccount }">

        <input type="submit" :value="
          (newAccount
            ? 'Sign Up'
            : (!forgotPass
              ? 'Login'
              : 'Send email')
          )
        ">

        <div class="msgBlock error"
          :class="{ open: error }"
          @click="error = false">
          <!-- eslint-disable-next-line -->
          <svg viewBox="0 0 25 25"><path d="M21.99,16.345,15.53,5.155a3.5,3.5,0,0,0-6.06,0L3.01,16.345A3.5,3.5,0,0,0,6.04,21.6H18.96a3.5,3.5,0,0,0,3.03-5.25Zm-9.54,2.32a1.165,1.165,0,1,1,1.16-1.17A1.163,1.163,0,0,1,12.45,18.665Zm1.16-5.06a1.16,1.16,0,0,1-2.32,0v-3.44a1.16,1.16,0,0,1,2.32,0Z"/></svg>
          <div>{{ errmsg }}</div>
        </div>

        <div class="minText" :class="{ hidden: newAccount }"
          @click="forgotPass = !forgotPass; error = false">
          {{ !forgotPass ? 'I forgot my password' : 'Back' }}
        </div>
      </form>

      <div style="padding: 20px 0; opacity: 0.7;">or</div>

      <div class="button wIcon" @click="googleLogin">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 118 120"><path d="M117.6,61.3636364 C117.6,57.1090909 117.218182,53.0181818 116.509091,49.0909091 L60,49.0909091 L60,72.3 L92.2909091,72.3 C90.9,79.8 86.6727273,86.1545455 80.3181818,90.4090909 L80.3181818,105.463636 L99.7090909,105.463636 C111.054545,95.0181818 117.6,79.6363636 117.6,61.3636364 L117.6,61.3636364 Z" fill="#4285F4"/><path d="M60,120 C76.2,120 89.7818182,114.627273 99.7090909,105.463636 L80.3181818,90.4090909 C74.9454545,94.0090909 68.0727273,96.1363636 60,96.1363636 C44.3727273,96.1363636 31.1454545,85.5818182 26.4272727,71.4 L6.38181818,71.4 L6.38181818,86.9454545 C16.2545455,106.554545 36.5454545,120 60,120 L60,120 Z" fill="#34A853"/><path d="M26.4272727,71.4 C25.2272727,67.8 24.5454545,63.9545455 24.5454545,60 C24.5454545,56.0454545 25.2272727,52.2 26.4272727,48.6 L26.4272727,33.0545455 L6.38181818,33.0545455 C2.31818182,41.1545455 0,50.3181818 0,60 C0,69.6818182 2.31818182,78.8454545 6.38181818,86.9454545 L26.4272727,71.4 L26.4272727,71.4 Z" fill="#FBBC05"/><path d="M60,23.8636364 C68.8090909,23.8636364 76.7181818,26.8909091 82.9363636,32.8363636 L100.145455,15.6272727 C89.7545455,5.94545455 76.1727273,0 60,0 C36.5454545,0 16.2545455,13.4454545 6.38181818,33.0545455 L26.4272727,48.6 C31.1454545,34.4181818 44.3727273,23.8636364 60,23.8636364 L60,23.8636364 Z" fill="#EA4335"/></svg>
        <div>Sign in with Google</div>
      </div>

      <div class="button wIcon" @click="githubLogin">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 20 20"><path d="M10 0C4.476 0 0 4.477 0 10c0 4.418 2.865 8.166 6.84 9.49.5.09.68-.218.68-.483 0-.237-.007-.866-.012-1.7-2.782.603-3.37-1.34-3.37-1.34-.454-1.157-1.11-1.464-1.11-1.464-.907-.62.07-.608.07-.608 1.003.07 1.53 1.03 1.53 1.03.893 1.53 2.342 1.087 2.912.83.09-.645.35-1.085.634-1.335-2.22-.253-4.555-1.11-4.555-4.943 0-1.09.39-1.984 1.03-2.683-.105-.253-.448-1.27.096-2.647 0 0 .84-.268 2.75 1.026A9.555 9.555 0 0110 4.836a9.59 9.59 0 012.504.337c1.91-1.294 2.747-1.026 2.747-1.026.548 1.377.204 2.394.1 2.647.64.7 1.03 1.592 1.03 2.683 0 3.842-2.34 4.687-4.566 4.935.36.308.678.92.678 1.852 0 1.336-.01 2.415-.01 2.743 0 .267.18.578.687.48A10 10 0 0020 10c0-5.522-4.478-10-10-10"/></svg>
        <div>Sign in with GitHub</div>
      </div>

      <div class="button wIcon" @click="phoneLogin">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
        <div>Sign in with phone</div>
      </div>

      <form class="block small" @submit="submitPhone" :class="{ hidden: !phoneForm }">
        <input type="tel" placeholder="Phone number" autocomplete="tel"
          v-model="phone" required :disabled="needPhoneCode">
        <input type="text" placeholder="Validation code" autocomplete="one-time-code"
          v-model="phoneCode" :class="{ hidden: !needPhoneCode }" :required="needPhoneCode">
        <div id="captcha" v-show="!needPhoneCode"/>
        <input type="submit" value="Confirm" v-show="needPhoneCode">

        <div class="msgBlock error"
          :class="{ open: phoneError }"
          @click="phoneError = false">
          <!-- eslint-disable-next-line -->
          <svg viewBox="0 0 25 25"><path d="M21.99,16.345,15.53,5.155a3.5,3.5,0,0,0-6.06,0L3.01,16.345A3.5,3.5,0,0,0,6.04,21.6H18.96a3.5,3.5,0,0,0,3.03-5.25Zm-9.54,2.32a1.165,1.165,0,1,1,1.16-1.17A1.163,1.163,0,0,1,12.45,18.665Zm1.16-5.06a1.16,1.16,0,0,1-2.32,0v-3.44a1.16,1.16,0,0,1,2.32,0Z"/></svg>
          <div>{{ phoneErrmsg }}</div>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

export default {
  name: 'Login',
  components: {},

  data: () => ({
    loading: false,
    newAccount: false,

    email: localStorage.getItem('email') || '',
    password: '',
    confirm: '',

    forgotPass: false,

    error: false,
    errmsg: null,

    phoneForm: false,
    phone: '',
    phoneCode: '',
    needPhoneCode: false,

    phoneError: false,
    phoneErrmsg: null,
  }),

  methods: {
    submit(e) {
      e.preventDefault();
      this.error = false;
      if (this.newAccount && this.password !== this.confirm) {
        this.error = true;
        this.errmsg = 'Passwords don\'t match';
        return;
      }

      this.loading = true;
      if (this.forgotPass) {
        console.log('Forgotpass');
        auth.sendPasswordResetEmail(this.email).then(() => {
          toast.success({ title: 'Password reset email sent !' });
          this.loading = false;
          this.forgotPass = false;
        }).catch((error) => {
          this.loading = false;
          this.error = true;
          this.errmsg = error.message;
        });
        return;
      }

      if (this.newAccount) {
        auth.createUserWithEmailAndPassword(this.email, this.password).then(() => {
          this.loading = false;
          toast.success({ title: 'Logged in !' });
          auth.currentUser.sendEmailVerification().then(() => {
            toast.success({ title: 'Confirmation email sent !' });
          }).catch((error) => {
            toast.error({ title: error.message });
          });
        }).catch((error) => {
          this.loading = false;
          this.error = true;
          this.errmsg = error.message;
        });
      } else {
        auth.signInWithEmailAndPassword(this.email, this.password).then(() => {
          this.loading = false;
          toast.success({ title: 'Logged in !' });
        }).catch((error) => {
          this.loading = false;
          this.error = true;
          this.errmsg = error.message;
        });
      }

      localStorage.setItem('email', this.email);
    },

    googleLogin() {
      this.loading = true;
      const provider = new window.firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).then((result) => {
        this.loading = false;
        console.log(result);
      }).catch((error) => {
        this.loading = false;
        this.error = true;
        this.errmsg = error.message;
      });
    },

    githubLogin() {
      this.loading = true;
      const provider = new window.firebase.auth.GithubAuthProvider();
      auth.signInWithPopup(provider).then((result) => {
        this.loading = false;
        console.log(result);
      }).catch((error) => {
        this.loading = false;
        this.error = true;
        this.errmsg = error.message;
      });
    },

    phoneLogin() {
      if (this.phoneForm) {
        this.phoneForm = false;
        return;
      }

      if (window.recaptchaVerifier) {
        this.phoneForm = true;
        return;
      }

      window.recaptchaVerifier = new window.firebase.auth.RecaptchaVerifier('captcha', {
        callback: () => {
          this.loading = true;
          auth.signInWithPhoneNumber(this.phone, window.recaptchaVerifier)
            .then((confirmationResult) => {
              this.loading = false;
              this.phoneError = false;
              this.needPhoneCode = true;
              window.confirmationResult = confirmationResult;
            }).catch((error) => {
              this.loading = false;
              this.phoneError = true;
              this.phoneErrmsg = error.message;
            });
        },
        'expired-callback': () => {
          this.loading = false;
          this.phoneError = false;
          toast.error({ title: 'Captcha expired, please retry' });
        },
      });

      window.recaptchaVerifier.render();
      this.phoneForm = true;
    },

    submitPhone(e) {
      e.preventDefault();
      this.phoneError = false;

      if (this.needPhoneCode) {
        window.confirmationResult.confirm(this.phoneCode).catch((error) => {
          this.phoneError = true;
          this.phoneErrmsg = error.message;
          this.phoneCode = '';
        });
        this.loading = true;
      }
    },
  },
};
</script>
