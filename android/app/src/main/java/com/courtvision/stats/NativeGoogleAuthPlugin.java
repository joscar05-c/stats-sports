package com.courtvision.stats;

import android.app.Activity;
import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {
    private final Executor executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void signIn(PluginCall call) {
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.trim().isEmpty()) {
            call.reject("Falta configurar el Web Client ID de Google (VITE_GOOGLE_WEB_CLIENT_ID).");
            return;
        }
        String trimmedClientId = webClientId.trim();
        String nonce = call.getString("nonce");

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("La actividad de Android no está disponible.");
            return;
        }

        CredentialManager credentialManager = CredentialManager.create(activity);
        GetSignInWithGoogleOption.Builder signInBuilder =
            new GetSignInWithGoogleOption.Builder(trimmedClientId);
        if (nonce != null && !nonce.trim().isEmpty()) {
            signInBuilder.setNonce(nonce.trim());
        }

        GetCredentialRequest primaryRequest = new GetCredentialRequest.Builder()
            .addCredentialOption(signInBuilder.build())
            .build();

        credentialManager.getCredentialAsync(
            activity,
            primaryRequest,
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(@NonNull GetCredentialResponse response) {
                    resolveCredentialResponse(call, response);
                }

                @Override
                public void onError(@NonNull GetCredentialException primaryError) {
                    if (primaryError instanceof GetCredentialCancellationException) {
                        call.reject("Inicio de sesión cancelado por el usuario.", "CANCELLED", primaryError);
                        return;
                    }
                    if (primaryError instanceof NoCredentialException) {
                        requestViaGoogleIdOption(call, activity, credentialManager, trimmedClientId, nonce);
                        return;
                    }
                    rejectCredentialError(call, primaryError);
                }
            }
        );
    }

    private void requestViaGoogleIdOption(
        PluginCall call,
        Activity activity,
        CredentialManager credentialManager,
        String webClientId,
        @Nullable String nonce
    ) {
        GetGoogleIdOption.Builder idOptionBuilder = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId)
            .setAutoSelectEnabled(false);
        if (nonce != null && !nonce.trim().isEmpty()) {
            idOptionBuilder.setNonce(nonce.trim());
        }

        GetCredentialRequest fallbackRequest = new GetCredentialRequest.Builder()
            .addCredentialOption(idOptionBuilder.build())
            .build();

        credentialManager.getCredentialAsync(
            activity,
            fallbackRequest,
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(@NonNull GetCredentialResponse response) {
                    resolveCredentialResponse(call, response);
                }

                @Override
                public void onError(@NonNull GetCredentialException fallbackError) {
                    rejectCredentialError(call, fallbackError);
                }
            }
        );
    }

    private void resolveCredentialResponse(PluginCall call, GetCredentialResponse response) {
        Credential credential = response.getCredential();
        if (
            credential instanceof CustomCredential &&
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())
        ) {
            try {
                GoogleIdTokenCredential tokenCredential =
                    GoogleIdTokenCredential.createFrom(credential.getData());
                JSObject payload = new JSObject();
                payload.put("idToken", tokenCredential.getIdToken());
                payload.put("email", tokenCredential.getId());
                payload.put("displayName", tokenCredential.getDisplayName());
                call.resolve(payload);
            } catch (Exception err) {
                call.reject("No se pudo leer el token de Google.", "PARSE_ERROR", err);
            }
            return;
        }
        call.reject("Google devolvió un tipo de credencial no compatible.", "UNSUPPORTED_CREDENTIAL");
    }

    private void rejectCredentialError(PluginCall call, GetCredentialException err) {
        if (err instanceof GetCredentialCancellationException) {
            call.reject("Inicio de sesión cancelado por el usuario.", "CANCELLED", err);
            return;
        }
        String msg = err.getMessage() != null ? err.getMessage() : err.getClass().getSimpleName();
        call.reject(msg, err.getType(), err);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        CredentialManager credentialManager = CredentialManager.create(activity);
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    call.resolve();
                }

                @Override
                public void onError(@NonNull ClearCredentialException e) {
                    call.resolve();
                }
            }
        );
    }
}
