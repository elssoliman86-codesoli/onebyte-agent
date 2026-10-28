package expo.modules.speechrecognition

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpeechRecognitionModule : Module() {
    private var speechRecognizer: SpeechRecognizer? = null
    private var currentPromise: Promise? = null
    private val context
        get() = requireNotNull(appContext.reactContext) { "React context is unavailable" }
    private val tag = "SpeechRecognition"

    override fun definition() = ModuleDefinition {
        Name("SpeechRecognition")

        Constants {
            mapOf(
                "ERROR_NETWORK" to SpeechRecognizer.ERROR_NETWORK,
                "ERROR_AUDIO" to SpeechRecognizer.ERROR_AUDIO,
                "ERROR_SERVER" to SpeechRecognizer.ERROR_SERVER,
                "ERROR_CLIENT" to SpeechRecognizer.ERROR_CLIENT,
                "ERROR_SPEECH_TIMEOUT" to SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                "ERROR_NO_MATCH" to SpeechRecognizer.ERROR_NO_MATCH,
                "ERROR_RECOGNIZER_BUSY" to SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                "ERROR_INSUFFICIENT_PERMISSIONS" to SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
            )
        }

        AsyncFunction("isAvailable") {
            SpeechRecognizer.isRecognitionAvailable(context)
        }

        AsyncFunction("startListening") { language: String?, maxResults: Int, partialResults: Boolean, prompt: String?, promise: Promise ->
            if (speechRecognizer != null) {
                promise.reject("ALREADY_LISTENING", "Speech recognition already in progress", null)
                return@AsyncFunction
            }

            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("PERMISSION_DENIED", "Microphone permission not granted", null)
                return@AsyncFunction
            }

            currentPromise = promise
            try {
                val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
                speechRecognizer = recognizer
                val safeMaxResults = maxResults.coerceIn(1, 5)
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, safeMaxResults)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults)
                    language?.let { putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
                    prompt?.let { putExtra(RecognizerIntent.EXTRA_PROMPT, it) }
                }

                recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(tag, "onReadyForSpeech")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(tag, "onBeginningOfSpeech")
                }

                override fun onRmsChanged(rmsdB: Float) {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {
                    Log.d(tag, "onEndOfSpeech")
                }

                override fun onError(error: Int) {
                    if (currentPromise !== promise) return
                    Log.e(tag, "Speech recognition error: $error")
                    val errorMessage = when (error) {
                        SpeechRecognizer.ERROR_NETWORK -> "Network error"
                        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                        SpeechRecognizer.ERROR_SERVER -> "Server error"
                        SpeechRecognizer.ERROR_CLIENT -> "Client error"
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
                        SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected"
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                        else -> "Unknown error ($error)"
                    }
                    cleanup()
                    promise.reject("RECOGNITION_ERROR", errorMessage, null)
                }

                override fun onResults(results: Bundle) {
                    if (currentPromise !== promise) return
                    val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!matches.isNullOrEmpty()) {
                        val finalResults = matches.take(safeMaxResults)
                        cleanup()
                        promise.resolve(finalResults)
                    } else {
                        cleanup()
                        promise.reject("NO_RESULTS", "No recognition results", null)
                    }
                }

                override fun onPartialResults(partialResults: Bundle) {
                    // Partial hypotheses must not settle the final-result promise.
                }

                override fun onEvent(eventType: Int, params: Bundle?) {}
                })
                recognizer.startListening(intent)
            } catch (error: Exception) {
                cleanup()
                promise.reject("START_FAILED", error.message ?: "Could not start speech recognition", error)
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stopListening") {
            speechRecognizer?.stopListening()
            true
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("cancelListening") {
            val activePromise = currentPromise
            currentPromise = null
            val recognizer = speechRecognizer
            speechRecognizer = null
            recognizer?.cancel()
            recognizer?.destroy()
            activePromise?.reject("CANCELLED", "Speech recognition cancelled", null)
            true
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("hasPermission") {
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        }

        AsyncFunction("requestPermission") { promise: Promise ->
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                promise.resolve(true)
                return@AsyncFunction
            }
            val permissions = appContext.permissions
            if (permissions == null) {
                promise.reject("E_NO_PERMISSIONS", "Permission manager is unavailable", null)
                return@AsyncFunction
            }
            permissions.askForPermissions(
                { responses ->
                    promise.resolve(
                        responses[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED,
                    )
                },
                Manifest.permission.RECORD_AUDIO,
            )
        }.runOnQueue(Queues.MAIN)
    }

    private fun cleanup() {
        val recognizer = speechRecognizer
        speechRecognizer = null
        currentPromise = null
        recognizer?.destroy()
    }
}
