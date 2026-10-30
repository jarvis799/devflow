package com.devflow.app

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

private val Lime = Color(0xFFA3E635)
private val LimeDeep = Color(0xFF4D7C0F)
private val Ink = Color(0xFF18181B)
private val Muted = Color(0xFF71717A)
private val Canvas = Color(0xFFF8FAF5)
private val Border = Color(0xFFE7E9E2)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { DevFlowApp(this) }
    }
}

private fun securePrefs(context: Context) = try {
    val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    EncryptedSharedPreferences.create(context, "devflow_secure", masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
} catch (_: Exception) { context.getSharedPreferences("devflow_secure_fallback", Context.MODE_PRIVATE) }

private object Api {
    private fun request(url: String, token: String? = null, method: String = "GET", body: JSONObject? = null, extraHeaders: Map<String,String> = emptyMap()): JSONObject {
        val c = (URL(url).openConnection() as HttpURLConnection)
        c.requestMethod = method
        c.connectTimeout = 18000; c.readTimeout = 30000
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.setRequestProperty("User-Agent", "DevFlow-Android/2.0")
        if (token != null) c.setRequestProperty("Authorization", if (url.contains("api.vercel.com")) "Bearer $token" else "Bearer $token")
        extraHeaders.forEach { (k,v) -> c.setRequestProperty(k,v) }
        if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json; charset=utf-8"); c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) } }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        c.disconnect()
        if (code !in 200..299) throw IllegalStateException("HTTP $code: ${try { JSONObject(text).optString("message", text.take(240)) } catch (_: Exception) { text.take(240) }}")
        return if (text.isBlank()) JSONObject().put("_status", code) else try { JSONObject(text) } catch (_: Exception) { JSONObject().put("_raw", text) }
    }
    fun github(url: String, token: String, method: String = "GET", body: JSONObject? = null) = request("https://api.github.com$url", token, method, body)
    fun githubArray(url: String, token: String): JSONArray {
        val c = URL("https://api.github.com$url").openConnection() as HttpURLConnection
        c.setRequestProperty("Authorization", "Bearer $token"); c.setRequestProperty("Accept", "application/vnd.github+json"); c.setRequestProperty("User-Agent", "DevFlow-Android/2.0")
        c.connectTimeout = 18000; c.readTimeout = 30000
        val code = c.responseCode; val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty(); c.disconnect()
        if (code !in 200..299) throw IllegalStateException("GitHub HTTP $code: $text")
        return JSONArray(text)
    }
    fun vercel(url: String, token: String, method: String = "GET", body: JSONObject? = null) = request("https://api.vercel.com$url", token, method, body)
    fun validateGemini(key: String) { request("https://generativelanguage.googleapis.com/v1beta/models?key=$key") }
    fun connectGithub(token: String) = github("/user", token).getString("login")
    fun connectVercel(token: String) = vercel("/v2/user", token).optJSONObject("user")?.optString("username", "connected") ?: "connected"
    fun repos(token: String): List<String> = githubArray("/user/repos?per_page=60&sort=updated", token).let { a -> (0 until a.length()).map { a.getJSONObject(it).optString("full_name") } }
    fun runs(token: String, repo: String): List<String> = github("/repos/$repo/actions/runs?per_page=15", token).optJSONArray("workflow_runs")?.let { a -> (0 until a.length()).map { val r=a.getJSONObject(it); "#${r.optLong("id")}  ${r.optString("name", "Workflow")} · ${r.optString("status")} / ${r.optString("conclusion", "pending")}" } } ?: emptyList()
    fun trigger(token: String, repo: String, workflow: String = "android-apk.yml") {
        github("/repos/$repo/actions/workflows/$workflow/dispatches", token, "POST", JSONObject().put("ref", "main"))
    }
    fun createRepoAndPush(token: String, repoName: String, description: String, files: List<ZipEntryData>, isPrivate: Boolean): String {
        val repo = github("/user/repos", token, "POST", JSONObject().put("name", repoName).put("description", description).put("private", isPrivate).put("auto_init", true))
        val full = repo.getString("full_name")
        // Git Trees API creates a single commit containing the uploaded archive contents.
        val uploadFiles = files.toMutableList()
        val hasWorkflow = uploadFiles.any { it.path.startsWith(".github/workflows/") && (it.path.endsWith(".yml") || it.path.endsWith(".yaml")) }
        val hasPackage = uploadFiles.any { it.path == "package.json" }
        val hasExpo = uploadFiles.any { it.path == "app.json" }
        val hasGradle = uploadFiles.any { it.path.endsWith("build.gradle") || it.path.endsWith("build.gradle.kts") }
        if (!hasWorkflow && (hasGradle || (hasPackage && hasExpo))) {
            val workflow = if (hasPackage && hasExpo) """name: Build Android APK
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - run: npm install --no-audit --no-fund
      - run: npx expo install --fix
      - run: npx expo prebuild --platform android --no-install
      - run: cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon
      - uses: actions/upload-artifact@v4
        with:
          name: devflow-apk
          path: android/app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
""" else """name: Build Android APK
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - run: chmod +x gradlew && ./gradlew assembleDebug --no-daemon
      - uses: actions/upload-artifact@v4
        with:
          name: devflow-apk
          path: '**/build/outputs/apk/debug/*.apk'
          if-no-files-found: error
"""
            uploadFiles.add(ZipEntryData(".github/workflows/android-apk.yml", Base64.encodeToString(workflow.toByteArray(Charsets.UTF_8), Base64.NO_WRAP), workflow.toByteArray(Charsets.UTF_8).size))
        }
        val blobs = JSONArray()
        for (f in uploadFiles) {
            val blob = github("/repos/$full/git/blobs", token, "POST", JSONObject().put("content", f.base64).put("encoding", "base64"))
            blobs.put(JSONObject().put("path", f.path).put("mode", "100644").put("type", "blob").put("sha", blob.getString("sha")))
        }
        val branch = "main"
        val tree = github("/repos/$full/git/trees", token, "POST", JSONObject().put("tree", blobs))
        val parent = github("/repos/$full/git/ref/heads/$branch", token)
        val commit = github("/repos/$full/git/commits", token, "POST", JSONObject().put("message", "Import project with DevFlow").put("tree", tree.getString("sha")).put("parents", JSONArray().put(parent.getJSONObject("object").getString("sha"))))
        github("/repos/$full/git/refs/heads/$branch", token, "PATCH", JSONObject().put("sha", commit.getString("sha")))
        return full
    }
}

private data class ZipEntryData(val path: String, val base64: String, val size: Int)
private fun extractZip(context: Context, uri: Uri): List<ZipEntryData> {
    val out = mutableListOf<ZipEntryData>()
    context.contentResolver.openInputStream(uri).use { raw ->
        requireNotNull(raw) { "Could not open ZIP file." }
        ZipInputStream(raw).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                val rawPath = e.name.replace('\\','/').removePrefix("./")
                if (rawPath.startsWith("/") || rawPath.split('/').any { it == ".." } || rawPath.contains(".git/") || rawPath.startsWith("__MACOSX/")) continue
                val bytes = ByteArrayOutputStream(); val buffer = ByteArray(8192); var total = 0
                while (true) { val n = zip.read(buffer); if (n <= 0) break; total += n; if (total > 2*1024*1024) break; bytes.write(buffer,0,n) }
                if (total > 2*1024*1024) continue
                val data = bytes.toByteArray()
                out.add(ZipEntryData(rawPath, Base64.encodeToString(data, Base64.NO_WRAP), data.size))
                require(out.size <= 700) { "ZIP has more than 700 usable files." }
            }
        }
    }
    require(out.isNotEmpty()) { "No usable files found in ZIP." }
    val firstParts = out.map { it.path.substringBefore('/') }.toSet()
    val strip = firstParts.size == 1 && out.all { it.path.contains('/') } && out.none { it.path.substringBefore('/').isBlank() }
    return if (strip) out.map { it.copy(path = it.path.substringAfter('/')) }.filter { it.path.isNotBlank() } else out
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DevFlowApp(context: Context) {
    val prefs = remember { securePrefs(context) }
    var tab by remember { mutableStateOf("Home") }
    var githubToken by remember { mutableStateOf(prefs.getString("github", "") ?: "") }
    var vercelToken by remember { mutableStateOf(prefs.getString("vercel", "") ?: "") }
    var geminiKey by remember { mutableStateOf(prefs.getString("gemini", "") ?: "") }
    var ghUser by remember { mutableStateOf("") }; var vcUser by remember { mutableStateOf("") }
    var repos by remember { mutableStateOf(listOf<String>()) }; var builds by remember { mutableStateOf(listOf<String>()) }
    var deployments by remember { mutableStateOf(listOf<String>()) }
    var repoName by remember { mutableStateOf("") }; var repoDescription by remember { mutableStateOf("Imported with DevFlow") }
    var selectedRepo by remember { mutableStateOf("") }; var isPrivate by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }; var status by remember { mutableStateOf("Ready") }; var error by remember { mutableStateOf("") }
    var zipName by remember { mutableStateOf("") }; var zipFiles by remember { mutableStateOf<List<ZipEntryData>>(emptyList()) }
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { busy=true; error=""; status="Inspecting ZIP…"; try { val result=withContext(Dispatchers.IO){ extractZip(context,uri) }; zipFiles=result; zipName=uri.lastPathSegment?.substringAfterLast(':') ?: "project.zip"; repoName=zipName.substringBeforeLast('.').lowercase().replace(Regex("[^a-z0-9._-]"), "-").trim('-').ifBlank { "devflow-project" }; status="${result.size} files ready to import" } catch(e:Exception){ error=e.message ?: "ZIP extraction failed"; status="ZIP import failed" } finally { busy=false } }
    }
    fun work(label: String, block: suspend () -> String) { scope.launch { busy=true; status=label; error=""; try { status=withContext(Dispatchers.IO){block()} } catch(e:Exception){ error=e.message ?: "Operation failed"; status="Action failed" } finally { busy=false } } }
    MaterialTheme(colorScheme = lightColorScheme(primary=LimeDeep, secondary=Lime, background=Canvas, surface=Color.White, onSurface=Ink)) {
        Scaffold(containerColor=Canvas, bottomBar={ NavigationBar(containerColor=Color.White, tonalElevation=4.dp) {
            listOf("Home" to Icons.Default.Home, "Projects" to Icons.Default.Folder, "Builds" to Icons.Default.Build, "Deploy" to Icons.Default.RocketLaunch, "Settings" to Icons.Default.Settings).forEach { (name, icon) ->
                NavigationBarItem(selected=tab==name, onClick={tab=name}, icon={ Icon(icon, null) }, label={ Text(name, fontSize=10.sp) }, colors=NavigationBarItemDefaults.colors(selectedIconColor=LimeDeep, selectedTextColor=LimeDeep, indicatorColor=Color(0xFFF3FCE0)))
            }
        } }) { pad ->
            Column(Modifier.fillMaxSize().padding(pad).padding(horizontal=18.dp)) {
                Row(Modifier.fillMaxWidth().padding(top=16.dp,bottom=12.dp), verticalAlignment=Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).background(Lime, RoundedCornerShape(14.dp)), contentAlignment=Alignment.Center) { Icon(Icons.Default.Terminal, null, tint=Ink) }
                    Spacer(Modifier.width(11.dp)); Column(Modifier.weight(1f)) { Text("DevFlow", fontSize=23.sp, fontWeight=FontWeight.Bold, color=Ink); Text("Mobile DevOps workspace", fontSize=12.sp, color=Muted) }
                    Box(Modifier.size(10.dp).background(if (ghUser.isNotBlank()) LimeDeep else Color(0xFFD4D4D8), CircleShape))
                }
                when(tab) {
                    "Home" -> HomeContent(status, error, ghUser, vcUser, zipName, zipFiles.size, repos.size, onPick={ picker.launch(arrayOf("application/zip","application/x-zip-compressed","application/octet-stream")) }, onImport={
                        if (githubToken.isBlank()) { error="Connect GitHub in Settings first." } else if (zipFiles.isEmpty()) { error="Choose a ZIP file first." } else if (repoName.isBlank()) { error="Enter a repository name." } else work("Creating GitHub repository and uploading files…") { val full=Api.createRepoAndPush(githubToken,repoName.trim(),repoDescription,zipFiles,isPrivate); Api.repos(githubToken).also { repos=it }; "Uploaded $full. Push a workflow file to enable APK builds." }
                    }, busy=busy, repoName=repoName, onRepoName={repoName=it}, isPrivate=isPrivate, onPrivate={isPrivate=it}, onSettings={tab="Settings"})
                    "Projects" -> SimpleListScreen("Projects", "Repositories available to your GitHub token", repos, empty="Connect GitHub, then refresh repositories.", onRefresh={ if(githubToken.isBlank()) error="Connect GitHub first." else work("Loading repositories…") { repos=Api.repos(githubToken); "Loaded ${repos.size} repositories" } }, onItem={selectedRepo=it; tab="Builds"})
                    "Builds" -> BuildsContent(repos, selectedRepo, onSelect={selectedRepo=it}, builds, busy, onLoad={ if(githubToken.isBlank()) error="Connect GitHub first." else if(selectedRepo.isBlank()) error="Select a repository first." else work("Loading workflow runs…") { builds=Api.runs(githubToken,selectedRepo); "Loaded ${builds.size} workflow runs" } }, onBuild={ if(githubToken.isBlank() || selectedRepo.isBlank()) error="Connect GitHub and select a repository." else work("Dispatching Android workflow…") { Api.trigger(githubToken,selectedRepo); "Workflow dispatched for $selectedRepo. Refresh in a few seconds." } })
                    "Deploy" -> DeployContent(vercelToken, repos, selectedRepo, deployments, onSelect={selectedRepo=it}, onRefresh={ if(vercelToken.isBlank()) error="Connect Vercel in Settings first." else work("Loading Vercel projects…") { val a=Api.vercel("/v9/projects?limit=30",vercelToken).optJSONArray("projects") ?: JSONArray(); deployments=(0 until a.length()).map { val p=a.getJSONObject(it); "${p.optString("name")} · ${p.optString("framework","unknown")}" }; "Loaded ${deployments.size} Vercel projects" } }, onDeploy={ if(vercelToken.isBlank()) error="Connect Vercel first." else if(selectedRepo.isBlank()) error="Select a GitHub repository first." else work("Requesting Vercel deployment…") { val body=JSONObject().put("name",selectedRepo.substringAfterLast('/').lowercase().replace("_","-")).put("gitSource",JSONObject().put("type","github").put("repo",selectedRepo).put("ref","main")); val d=Api.vercel("/v13/deployments",vercelToken,"POST",body); "Deployment requested: ${d.optString("url", d.optString("id"))}" } })
                    "Settings" -> SettingsContent(githubToken, {githubToken=it}, vercelToken, {vercelToken=it}, geminiKey, {geminiKey=it}, ghUser, vcUser, busy, onConnect={ kind, value -> work("Validating $kind credentials…") { when(kind) { "GitHub" -> { val user=Api.connectGithub(value); githubToken=value; prefs.edit().putString("github",value).apply(); ghUser=user; repos=Api.repos(value); "Connected as @$user" }; "Vercel" -> { val user=Api.connectVercel(value); vercelToken=value; prefs.edit().putString("vercel",value).apply(); vcUser=user; "Connected to Vercel as $user" }; else -> { Api.validateGemini(value); geminiKey=value; prefs.edit().putString("gemini",value).apply(); "Gemini API key validated" } } } }, onDisconnect={kind -> when(kind){"GitHub"->{githubToken="";ghUser="";prefs.edit().remove("github").apply()};"Vercel"->{vercelToken="";vcUser="";prefs.edit().remove("vercel").apply()};else->{geminiKey="";prefs.edit().remove("gemini").apply()}}; status="$kind disconnected" })
                }
                if (busy) { LinearProgressIndicator(Modifier.fillMaxWidth().padding(top=8.dp), color=LimeDeep, trackColor=Color(0xFFE4E4E7)) }
                if (error.isNotBlank()) Card(Modifier.fillMaxWidth().padding(top=8.dp), colors=CardDefaults.cardColors(containerColor=Color(0xFFFEF2F2)), shape=RoundedCornerShape(14.dp)) { Text(error, Modifier.padding(12.dp), color=Color(0xFFB91C1C), fontSize=12.sp) }
                Text(status, Modifier.padding(top=8.dp,bottom=8.dp), color=Muted, fontSize=11.sp, maxLines=2, overflow=TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable private fun PageTitle(title:String, subtitle:String) { Text(title,fontSize=26.sp,fontWeight=FontWeight.Bold,color=Ink); Text(subtitle,fontSize=13.sp,color=Muted,modifier=Modifier.padding(top=3.dp,bottom=16.dp)) }
@Composable private fun CardBox(content:@Composable ColumnScope.()->Unit) { Card(Modifier.fillMaxWidth().padding(bottom=12.dp), shape=RoundedCornerShape(22.dp), colors=CardDefaults.cardColors(containerColor=Color.White), border=androidx.compose.foundation.BorderStroke(1.dp,Border), elevation=CardDefaults.cardElevation(defaultElevation=1.dp)) { Column(Modifier.padding(16.dp),content=content) } }
@Composable private fun ActionButton(text:String, icon:@Composable (() -> Unit)? = null, enabled:Boolean=true, onClick:()->Unit) { Button(onClick=onClick, enabled=enabled, modifier=Modifier.fillMaxWidth().height(48.dp), shape=RoundedCornerShape(14.dp), colors=ButtonDefaults.buttonColors(containerColor=Lime,contentColor=Ink,disabledContainerColor=Color(0xFFE4E4E7),disabledContentColor=Muted)) { if(icon!=null){icon();Spacer(Modifier.width(8.dp))}; Text(text,fontWeight=FontWeight.Bold) } }
@Composable private fun Field(label:String,value:String,onValue:(String)->Unit,placeholder:String,secret:Boolean=false) { Column(Modifier.padding(bottom=12.dp)) { Text(label,fontSize=12.sp,fontWeight=FontWeight.SemiBold,color=Ink); OutlinedTextField(value,onValue,modifier=Modifier.fillMaxWidth().padding(top=5.dp),placeholder={Text(placeholder,fontSize=13.sp)},singleLine=true,shape=RoundedCornerShape(13.dp),visualTransformation=if(secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None, keyboardOptions=if(secret) KeyboardOptions(keyboardType=KeyboardType.Password) else KeyboardOptions.Default, colors=OutlinedTextFieldDefaults.colors(focusedBorderColor=LimeDeep, unfocusedBorderColor=Border, focusedContainerColor=Color.White, unfocusedContainerColor=Color.White)) } }

@Composable private fun HomeContent(status:String,error:String,ghUser:String,vcUser:String,zipName:String,fileCount:Int,repoCount:Int,onPick:()->Unit,onImport:()->Unit,busy:Boolean,repoName:String,onRepoName:(String)->Unit,isPrivate:Boolean,onPrivate:(Boolean)->Unit,onSettings:()->Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item { PageTitle("Build from your phone", "ZIP → GitHub → GitHub Actions → APK / Vercel") }
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(10.dp)) { StatCard("GitHub",if(ghUser.isBlank()) "Not connected" else "@$ghUser", Modifier.weight(1f)); StatCard("Projects",repoCount.toString(),Modifier.weight(1f)) } }
        item { Spacer(Modifier.height(12.dp)); CardBox { Text("Import a project",fontSize=18.sp,fontWeight=FontWeight.Bold,color=Ink); Text("Choose a ZIP archive. DevFlow safely inspects it, then can create a GitHub repository and upload the files.",fontSize=13.sp,color=Muted,modifier=Modifier.padding(top=5.dp,bottom=14.dp)); ActionButton(if(zipName.isBlank()) "Choose ZIP archive" else "Choose another ZIP", { Icon(Icons.Default.FolderOpen,null) },onClick=onPick); if(zipName.isNotBlank()){ Text("$zipName · $fileCount files",fontSize=12.sp,color=LimeDeep,modifier=Modifier.padding(top=10.dp)); Spacer(Modifier.height(12.dp)); Field("Repository name",repoName,onRepoName,"my-project"); Row(verticalAlignment=Alignment.CenterVertically){ Checkbox(isPrivate,onPrivate,colors=CheckboxDefaults.colors(checkedColor=LimeDeep)); Text("Create private repository",fontSize=13.sp,color=Ink) }; ActionButton("Create repository & upload",{Icon(Icons.Default.CloudUpload,null)},enabled=!busy,onClick=onImport) } } }
        item { CardBox { Text("Connection status",fontSize=17.sp,fontWeight=FontWeight.Bold,color=Ink); StatusRow("GitHub",if(ghUser.isBlank()) "Connect in Settings" else "Connected · @$ghUser",ghUser.isNotBlank()); StatusRow("Vercel",if(vcUser.isBlank()) "Optional · not connected" else "Connected · $vcUser",vcUser.isNotBlank()); TextButton(onClick=onSettings){Text("Manage credentials",color=LimeDeep)} } }
        item { CardBox { Text("No custom backend",fontWeight=FontWeight.Bold,color=Ink); Text("Your tokens are stored locally using Android encrypted preferences when supported. API calls go directly to GitHub, Vercel and Google. ZIP import skips unsafe paths and files over 2 MB.",fontSize=12.sp,color=Muted,modifier=Modifier.padding(top=6.dp)) } }
    }
}
@Composable private fun StatCard(title:String,value:String,modifier:Modifier=Modifier){ Card(modifier,shape=RoundedCornerShape(18.dp),colors=CardDefaults.cardColors(containerColor=Color.White),border=androidx.compose.foundation.BorderStroke(1.dp,Border)){Column(Modifier.padding(14.dp)){Text(title,fontSize=12.sp,color=Muted);Text(value,fontSize=17.sp,fontWeight=FontWeight.Bold,color=Ink,maxLines=1,overflow=TextOverflow.Ellipsis)}} }
@Composable private fun StatusRow(label:String,value:String,ok:Boolean){Row(Modifier.fillMaxWidth().padding(top=10.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(8.dp).background(if(ok)LimeDeep else Color(0xFFD4D4D8),CircleShape));Column(Modifier.padding(start=9.dp).weight(1f)){Text(label,fontSize=13.sp,fontWeight=FontWeight.SemiBold,color=Ink);Text(value,fontSize=12.sp,color=Muted)}}}
@Composable private fun SimpleListScreen(title:String,subtitle:String,items:List<String>,empty:String,onRefresh:()->Unit,onItem:(String)->Unit){ Column(Modifier.fillMaxSize()){PageTitle(title,subtitle);Button(onClick=onRefresh,colors=ButtonDefaults.buttonColors(containerColor=Lime,contentColor=Ink),shape=RoundedCornerShape(12.dp)){Icon(Icons.Default.Refresh,null);Spacer(Modifier.width(6.dp));Text("Refresh")}; if(items.isEmpty()) CardBox{Text(empty,color=Muted,fontSize=13.sp)} else LazyColumn {items(items){item->CardBox{Row(Modifier.fillMaxWidth().clickable{onItem(item)},verticalAlignment=Alignment.CenterVertically){Icon(Icons.Default.Folder,null,tint=LimeDeep);Text(item,Modifier.weight(1f).padding(start=10.dp),fontWeight=FontWeight.SemiBold,color=Ink,fontSize=13.sp);Icon(Icons.Default.ChevronRight,null,tint=Muted)}}}}} }
@Composable private fun BuildsContent(repos:List<String>,selected:String,onSelect:(String)->Unit,builds:List<String>,busy:Boolean,onLoad:()->Unit,onBuild:()->Unit){Column(Modifier.fillMaxSize()){PageTitle("Build monitor","Trigger and inspect real GitHub Actions runs"); Field("Repository (owner/name)",selected,onSelect,"owner/repository"); if(repos.isNotEmpty()) { Text("Recent repositories",fontSize=12.sp,color=Muted); Row(Modifier.fillMaxWidth().padding(vertical=6.dp),horizontalArrangement=Arrangement.spacedBy(6.dp)){repos.take(3).forEach{AssistChip(onClick={onSelect(it)},label={Text(it.substringAfterLast('/'),fontSize=10.sp)},colors=AssistChipDefaults.assistChipColors(containerColor=Color.White))} } }; Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick=onBuild,enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=Lime,contentColor=Ink)){Icon(Icons.Default.PlayArrow,null);Text("Run build")}; OutlinedButton(onClick=onLoad,enabled=!busy){Icon(Icons.Default.Refresh,null);Text("Refresh runs")} }; Spacer(Modifier.height(14.dp));Text("Workflow runs",fontSize=17.sp,fontWeight=FontWeight.Bold,color=Ink);if(builds.isEmpty())CardBox{Text("No runs loaded yet. Select a repository and refresh.",fontSize=13.sp,color=Muted)}else LazyColumn{items(builds){CardBox{Text(it,fontSize=13.sp,color=Ink)}}}}}
@Composable private fun DeployContent(token:String,repos:List<String>,selected:String,onSelect:(String)->Unit,deployments:List<String>,onRefresh:()->Unit,onDeploy:()->Unit){Column(Modifier.fillMaxSize()){PageTitle("Deployments","Vercel projects and Git-based deployments");Field("GitHub repository (owner/name)",selected,onSelect,"owner/repository");Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick=onDeploy,enabled=token.isNotBlank(),colors=ButtonDefaults.buttonColors(containerColor=Lime,contentColor=Ink)){Icon(Icons.Default.RocketLaunch,null);Text("Deploy selected repo")};OutlinedButton(onClick=onRefresh){Icon(Icons.Default.Refresh,null);Text("Refresh")}};Spacer(Modifier.height(14.dp));Text("Vercel projects",fontSize=17.sp,fontWeight=FontWeight.Bold,color=Ink);if(deployments.isEmpty())CardBox{Text("Connect Vercel in Settings, then refresh. GitHub integration must be enabled in Vercel for Git deployments.",fontSize=13.sp,color=Muted)}else LazyColumn{items(deployments){CardBox{Text(it,fontSize=13.sp,color=Ink)}}}}}

@Composable private fun SettingsContent(gh:String,onGh:(String)->Unit,vc:String,onVc:(String)->Unit,gem:String,onGem:(String)->Unit,ghUser:String,vcUser:String,busy:Boolean,onConnect:(String,String)->Unit,onDisconnect:(String)->Unit){LazyColumn(Modifier.fillMaxSize()){item{PageTitle("Settings","Connect services with your own API credentials")};item{CardBox{Text("GitHub",fontSize=18.sp,fontWeight=FontWeight.Bold,color=Ink);Text(if(ghUser.isBlank())"Not connected" else "Connected as @$ghUser",fontSize=12.sp,color=if(ghUser.isBlank())Muted else LimeDeep,modifier=Modifier.padding(vertical=8.dp));Field("Personal Access Token",gh,onGh,"github_pat_…",true);Text("Repository access and Actions workflow permissions are required.",fontSize=11.sp,color=Muted);ActionButton(if(ghUser.isBlank())"Connect GitHub" else "Reconnect GitHub",enabled=!busy){onConnect("GitHub",gh)};if(ghUser.isNotBlank())TextButton(onClick={onDisconnect("GitHub")}){Text("Disconnect",color=Color(0xFFB91C1C))}}};item{CardBox{Text("Vercel",fontSize=18.sp,fontWeight=FontWeight.Bold,color=Ink);Text(if(vcUser.isBlank())"Optional · not connected" else "Connected as $vcUser",fontSize=12.sp,color=if(vcUser.isBlank())Muted else LimeDeep,modifier=Modifier.padding(vertical=8.dp));Field("Vercel access token",vc,onVc,"vercel token",true);ActionButton("Connect Vercel",enabled=!busy){onConnect("Vercel",vc)};if(vcUser.isNotBlank())TextButton(onClick={onDisconnect("Vercel")}){Text("Disconnect",color=Color(0xFFB91C1C))}}};item{CardBox{Text("Google Gemini",fontSize=18.sp,fontWeight=FontWeight.Bold,color=Ink);Field("Gemini API key",gem,onGem,"AIza…",true);Text("Gemini key is validated and saved. AI log diagnosis is a future native module; no fixes are applied automatically.",fontSize=11.sp,color=Muted,modifier=Modifier.padding(bottom=10.dp));ActionButton("Validate & save key",enabled=!busy){onConnect("Gemini",gem)};if(gem.isNotBlank())TextButton(onClick={onDisconnect("Gemini")}){Text("Clear key",color=Color(0xFFB91C1C))}}};item{CardBox{Text("Security & limitations",fontSize=16.sp,fontWeight=FontWeight.Bold,color=Ink);Text("Credentials use Android encrypted preferences where available. Never share your PAT. APK builds run on GitHub-hosted runners. A Vercel Git deployment requires the GitHub integration to be configured in your Vercel account. The included APK workflow produces a debug APK, not a Play Store signed release.",fontSize=12.sp,color=Muted,modifier=Modifier.padding(top=8.dp))}}}}
