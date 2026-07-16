//
//  SettingsView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct SettingsView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @State private var showConfirmAlert = false
    @State private var isImporting = false
    @State private var importError: String? = nil
    @State private var showFilePicker = false
    @State private var selectedFiles: [URL] = []
    @State private var showRBDatabase = false
    @State private var rbImportedData: [String] = []
    @State private var showSystemDatabase = false
    @State private var importProgress: Double = 0.0
    @State private var showProgressAlert = false
    
    // 读取CSV相关状态
    @State private var showCSVFilePicker = false
    @State private var csvSelectedFiles: [URL] = []
    @State private var showCSVData = false
    @State private var csvData: [String] = []
    
    // 坚果云文件选择相关状态
    @State private var showFilePickerForJianGuoYun = false
    @State private var selectedFilesForJianGuoYun: [URL] = []
    
    // 恢复数据库相关状态
    @State private var showFilePickerForRBRestore = false
    @State private var selectedFilesForRBRestore: [URL] = []
    @State private var showFilePickerForSYSRestore = false
    @State private var selectedFilesForSYSRestore: [URL] = []
    
    // 仓库变动相关状态
    @State private var showWarehouseChanges = false
    @State private var showBoxChanges = false
    @State private var pendingBoxRepository: NSManagedObject?
    @State private var pendingPartsBox: NSManagedObject?

    var body: some View {
        GeometryReader { geometry in
            let containerWidth = geometry.size.width * 0.8
            
            VStack(alignment: .leading) {
                Text("系统设置")
                    .font(.system(size: 24, weight: .bold))
                    .padding()
                
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                    // 第一组：RB数据库
                    VStack(alignment: .leading, spacing: 8) {
                        Text("RB数据库")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                Button(action: {
                                    // 实现导入RB功能
                                    importRBData()
                                }) {
                                    Text("导入RB")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.green)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现显示RB功能
                                    showRBDatabase.toggle()
                                }) {
                                    Text("显示RB")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.purple)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现坚果云备份RB功能
                                    JianGuoYunBackup.backupToJianGuoYun(databaseType: .rb)
                                }) {
                                    Text("坚果备份RB")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.blue)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现本地备份RB功能
                                    JianGuoYunBackup.backupToLocal(databaseType: .rb)
                                }) {
                                    Text("本地备份RB")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.green)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现恢复RB功能
                                    showFilePickerForRBRestore.toggle()
                                }) {
                                    Text("恢复RB")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.orange)
                                        .cornerRadius(6)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(width: containerWidth)
                    
                    // 第二组：系统数据库
                    VStack(alignment: .leading, spacing: 8) {
                        Text("系统数据库")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                Button(action: {
                                    // 开始初始化数据库流程
                                    startInitDatabaseProcess()
                                }) {
                                    Text("初始化数据库")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.red)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现显示系统数据库功能
                                    showSystemDatabase.toggle()
                                }) {
                                    Text("显示系统数据库")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.brown)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现坚果云备份功能
                                    JianGuoYunBackup.backupToJianGuoYun(databaseType: .system)
                                }) {
                                    Text("坚果备份SYS")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.blue)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现本地备份SYS功能
                                    JianGuoYunBackup.backupToLocal(databaseType: .system)
                                }) {
                                    Text("本地备份SYS")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.green)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 测试数据库状态
                                    DatabaseChecker.checkSystemDatabaseStatus()
                                    DatabaseChecker.checkBackupProcess()
                                }) {
                                    Text("测试数据库")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.purple)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现恢复SYS功能
                                    showFilePickerForSYSRestore.toggle()
                                }) {
                                    Text("恢复SYS")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.orange)
                                        .cornerRadius(6)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(width: containerWidth)
                    
                    // 第三组：仓库变动
                    VStack(alignment: .leading, spacing: 8) {
                        Text("仓库变动")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                Button(action: {
                                    // 实现仓库变动功能
                                    showWarehouseChanges.toggle()
                                }) {
                                    Text("仓库变动")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.blue)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现盒子变动功能
                                    showBoxChanges.toggle()
                                }) {
                                    Text("盒子变动")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.green)
                                        .cornerRadius(6)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(width: containerWidth)
                    
                    // 第四组：文件处理
                    VStack(alignment: .leading, spacing: 8) {
                        Text("文件处理")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                Button(action: {
                                    // 实现读取CSV功能
                                    showCSVFilePicker.toggle()
                                }) {
                                    Text("读取CSV")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.orange)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 实现类别检查功能
                                    checkPartCategories()
                                }) {
                                    Text("类别检查")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.orange)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    // 选择文件上传到坚果云
                                    showFilePickerForJianGuoYun.toggle()
                                }) {
                                    Text("上传至坚果云")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 120, height: 40) // 8个中文字的宽度，每个中文字约15pt宽
                                        .background(Color.purple)
                                        .cornerRadius(6)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(width: containerWidth)
                }
                .padding()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
            .sheet(isPresented: $showFilePicker) {
                DocumentPicker(
                    isPresented: $showFilePicker,
                    selectedFiles: $selectedFiles,
                    onImport: processImportedFiles
                )
            }
            .alert(isPresented: Binding(get: { importError != nil }, set: { _ in importError = nil })) {
                Alert(
                    title: Text("导入错误"),
                    message: Text(importError ?? "未知错误"),
                    dismissButton: .default(Text("确定"))
                )
            }
            .alert(isPresented: $showProgressAlert) {
                Alert(
                    title: Text("导入进度"),
                    message: Text("正在导入数据，请稍候... \(Int(importProgress * 100))%"),
                    dismissButton: .cancel(Text("取消")) {
                        // 取消导入操作
                        isImporting = false
                    }
                )
            }
            .sheet(isPresented: $showRBDatabase) {
                RBDatabaseView(importedData: $rbImportedData)
            }
            .sheet(isPresented: $showCSVFilePicker) {
                DocumentPicker(
                    isPresented: $showCSVFilePicker,
                    selectedFiles: $csvSelectedFiles,
                    onImport: processCSVFile
                )
            }
            .sheet(isPresented: $showCSVData) {
                VStack {
                    Text("CSV文件数据预览")
                        .font(.system(size: 20, weight: .bold))
                        .padding()
                    
                    ScrollView {
                        ForEach(csvData, id: \.self) {
                            Text($0)
                                .font(.system(size: 12))
                                .padding(2)
                        }
                    }
                    
                    Button(action: {
                        showCSVData.toggle()
                    }) {
                        Text("关闭")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 32)
                            .padding(.vertical, 12)
                            .background(Color.gray)
                            .cornerRadius(8)
                    }
                    .padding()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white)
            }
            .sheet(isPresented: $showSystemDatabase) {
                SystemDatabaseView()
            }
            .sheet(isPresented: $showFilePickerForJianGuoYun) {
                DocumentPicker(
                    isPresented: $showFilePickerForJianGuoYun,
                    selectedFiles: $selectedFilesForJianGuoYun,
                    onImport: { urls in
                        DispatchQueue.main.async {
                            JianGuoYunBackup.uploadSelectedFilesToJianGuoYun(urls)
                        }
                    }
                )
            }
            .sheet(isPresented: $showFilePickerForRBRestore) {
                DocumentPicker(
                    isPresented: $showFilePickerForRBRestore,
                    selectedFiles: $selectedFilesForRBRestore,
                    onImport: { urls in
                        JianGuoYunBackup.restoreDatabase(from: urls, databaseType: .rb)
                    }
                )
            }
            .sheet(isPresented: $showFilePickerForSYSRestore) {
                DocumentPicker(
                    isPresented: $showFilePickerForSYSRestore,
                    selectedFiles: $selectedFilesForSYSRestore,
                    onImport: { urls in
                        JianGuoYunBackup.restoreDatabase(from: urls, databaseType: .system)
                    }
                )
            }
            .sheet(isPresented: $showWarehouseChanges) {
                WarehouseChangesView(isPresented: $showWarehouseChanges, viewContext: viewContext)
            }
            .sheet(isPresented: $showBoxChanges) {
                BoxChangesView(isPresented: $showBoxChanges, viewContext: viewContext)
            }
            }
        }
    }
    
    // 获取待定盒子仓库信息
    private func getPendingBoxRepositoryInfo() -> String {
        ensurePendingBoxRepositoryExists()
        
        if let pendingRepo = pendingBoxRepository {
            let boxCount = getBoxCount(for: pendingRepo)
            return "包含 \(boxCount) 个盒子"
        }
        return "未创建"
    }
    
    // 获取待定零件盒子信息
    private func getPendingPartsBoxInfo() -> String {
        ensurePendingBoxRepositoryExists()
        
        if let pendingBox = pendingPartsBox {
            let partCount = getPartCount(for: pendingBox)
            return "包含 \(partCount) 种零件"
        }
        return "未创建"
    }
    
    // 确保待定盒子仓库和待定零件盒子存在
    private func ensurePendingBoxRepositoryExists() {
        // 查找待定盒子仓库
        let repoFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        repoFetchRequest.predicate = NSPredicate(format: "name == %@", "待定盒子")
        
        do {
            let repos = try viewContext.fetch(repoFetchRequest)
            if let repo = repos.first {
                pendingBoxRepository = repo
            } else {
                // 创建待定盒子仓库
                let newRepo = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
                newRepo.setValue("待定盒子", forKey: "name")
                
                // 生成唯一ID
                let allRepoFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
                let allRepos = try viewContext.fetch(allRepoFetchRequest)
                let maxId = allRepos.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newRepo.setValue(maxId + 1, forKey: "id")
                
                try viewContext.save()
                pendingBoxRepository = newRepo
            }
            
            // 查找待定零件盒子
            let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
            boxFetchRequest.predicate = NSPredicate(format: "name == %@", "待定零件")
            
            let boxes = try viewContext.fetch(boxFetchRequest)
            if let box = boxes.first {
                pendingPartsBox = box
            } else if let pendingRepo = pendingBoxRepository {
                // 创建待定零件盒子
                let newBox = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
                newBox.setValue("待定零件", forKey: "name")
                
                // 生成唯一ID
                let allBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
                let allBoxes = try viewContext.fetch(allBoxFetchRequest)
                let maxId = allBoxes.compactMap { $0.value(forKey: "id") as? Int32 }.max() ?? 0
                newBox.setValue(maxId + 1, forKey: "id")
                
                // 设置boxNumber
                let repoBoxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
                let repoBoxes = try viewContext.fetch(repoBoxFetchRequest)
                let pendingRepoBoxes = repoBoxes.filter { 
                    if let boxRepo = $0.value(forKey: "repository") as? NSManagedObject {
                        return boxRepo.objectID == pendingRepo.objectID
                    }
                    return false
                }
                let maxBoxNumber = pendingRepoBoxes.compactMap { $0.value(forKey: "boxNumber") as? Int32 }.max() ?? 0
                newBox.setValue(maxBoxNumber + 1, forKey: "boxNumber")
                
                // 设置仓库关联
                newBox.setValue(pendingRepo, forKey: "repository")
                if let repoId = pendingRepo.value(forKey: "id") as? Int32 {
                    newBox.setValue(repoId, forKey: "repositoryId")
                }
                
                try viewContext.save()
                pendingPartsBox = newBox
            }
        } catch {
            print("Error ensuring pending box repository exists: \(error)")
        }
    }
    
    // 获取仓库中的盒子数量
    private func getBoxCount(for repository: NSManagedObject) -> Int {
        return (repository.value(forKey: "boxes") as? Set<NSManagedObject>)?.count ?? 0
    }
    
    // 获取盒子中的零件数量
    private func getPartCount(for box: NSManagedObject) -> Int {
        return (box.value(forKey: "parts") as? Set<NSManagedObject>)?.count ?? 0
    }
    
    private func initDatabase() {
        // 实现数据库初始化功能
        // 删除所有现有数据
        let entities = ["Repository", "Box", "Part"]
        
        do {
            for entityName in entities {
                let fetchRequest = NSFetchRequest<NSFetchRequestResult>(entityName: entityName)
                let batchDeleteRequest = NSBatchDeleteRequest(fetchRequest: fetchRequest)
                try viewContext.execute(batchDeleteRequest)
                print("已删除 \(entityName) 实体数据")
            }
            
            // 创建"待定盒子"仓库
            let pendingRepo = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
            pendingRepo.setValue("待定盒子", forKey: "name")
            pendingRepo.setValue(Int32(1), forKey: "id")
            
            // 创建"待定零件"盒子
            let pendingBox = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
            pendingBox.setValue("待定零件", forKey: "name")
            pendingBox.setValue(Int32(1), forKey: "id")
            pendingBox.setValue(Int32(1), forKey: "boxNumber")
            pendingBox.setValue(pendingRepo, forKey: "repository")
            pendingBox.setValue(Int32(1), forKey: "repositoryId")
            
            try viewContext.save()
            print("数据库初始化成功，已创建'待定盒子'仓库和'待定零件'盒子")
            
            // 显示初始化成功提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "初始化成功", message: "系统数据库已成功初始化，已自动创建'待定盒子'仓库和'待定零件'盒子", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        } catch {
            let nsError = error as NSError
            print("数据库初始化失败: \(nsError)")
            
            // 显示初始化失败提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "初始化失败", message: "数据库初始化失败: \(nsError.localizedDescription)", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        }
    }
    
    private func importRBData() {
        // 直接显示文件选择器，不再运行测试函数
        // 测试函数可能会干扰正常的文件导入流程
        showFilePicker.toggle()
    }
    
    private func processImportedFiles(_ urls: [URL]) {
        // 处理导入的CSV文件
        isImporting = true
        importError = nil
        importProgress = 0.0
        showProgressAlert = true
        
        print("开始处理导入的文件: \(urls.count) 个文件")
        
        // 在后台线程处理文件导入，避免阻塞UI
        DispatchQueue.global(qos: .userInitiated).async {
            // 初始化总成功导入计数器
            var totalSuccessfulImports = 0
            let totalFiles = urls.count
            
            // 解析CSV文件并导入数据到RB数据库
            
            for (index, url) in urls.enumerated() {
                print("原始URL: \(url)")
                print("URL路径: \(url.path)")
                print("URL方案: \(url.scheme ?? "无")")
                print("是否为文件URL: \(url.isFileURL)")
                
                // 对于安全范围URL，我们需要使用startAccessingSecurityScopedResource
                var shouldReleaseAccess = false
                
                // 尝试获取安全范围URL的访问权限
                if url.startAccessingSecurityScopedResource() {
                    shouldReleaseAccess = true
                    print("✅ 成功获取安全范围URL的访问权限")
                } else {
                    print("⚠️ 无法获取安全范围URL的访问权限，尝试在没有访问权限的情况下读取")
                }
                
                // 使用defer语句确保无论是否发生错误都会释放访问权限
                defer {
                    if shouldReleaseAccess {
                        url.stopAccessingSecurityScopedResource()
                        print("释放安全范围URL的访问权限")
                    }
                }
                
                // 创建一个新的私有队列上下文用于导入，避免线程安全问题
                let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                privateContext.parent = PersistenceController.shared.rbContainer.viewContext
                
                do {
                    // 计算当前文件的权重（每个文件占总进度的比例）
                    let fileWeight = 1.0 / Double(totalFiles)
                    // 计算当前文件的起始进度
                    let fileStartProgress = Double(index) / Double(totalFiles)
                    
                    // 使用CSVImporter解析文件，传入进度回调
                    let fileImports = try CSVImporter.shared.parseCSVFileToRB(url, context: privateContext) { fileProgress in
                        // 计算整体进度：起始进度 + 文件权重 * 文件进度
                        let overallProgress = fileStartProgress + fileWeight * fileProgress
                        DispatchQueue.main.async {
                            importProgress = overallProgress
                        }
                        print("整体进度: \(Int(overallProgress * 100))%")
                    }
                    totalSuccessfulImports += fileImports
                    print("文件导入完成，成功导入 \(fileImports) 条数据")
                    
                    // 保存私有上下文，将更改推送到父上下文
                    try privateContext.save()
                    print("成功保存私有上下文")
                    
                    // 保存父上下文，将更改持久化到磁盘
                    let parentContext = PersistenceController.shared.rbContainer.viewContext
                    parentContext.performAndWait {
                        do {
                            try parentContext.save()
                            print("成功保存父上下文，确保数据持久化")
                        } catch {
                            print("保存父上下文失败: \(error.localizedDescription)")
                        }
                    }
                } catch {
                    print("文件导入失败: \(error)")
                    
                    // 即使文件导入失败，也要更新进度，以便继续处理下一个文件
                    let progress = Double(index + 1) / Double(totalFiles)
                    DispatchQueue.main.async {
                        importProgress = progress
                    }
                    print("当前进度: \(Int(progress * 100))%")
                }
            }
            
            print("所有文件导入完成，总共成功导入 \(totalSuccessfulImports) 条数据")
            
            // 最后再保存一次父上下文，确保所有数据都被保存
            print("开始最终保存上下文")
            
            // 保存父上下文，将更改持久化到磁盘
            let parentContext = PersistenceController.shared.rbContainer.viewContext
            parentContext.performAndWait {
                do {
                    if parentContext.hasChanges {
                        try parentContext.save()
                        print("RB数据导入完成，最终保存成功")
                    } else {
                        print("父上下文无变化，跳过最终保存")
                    }
                } catch {
                    print("保存父上下文失败: \(error.localizedDescription)")
                }
            }
            
            print("RB数据导入处理完成")
            
            // 显示导入完成提示
            let importMessage = "导入已完成，共导入 \(totalSuccessfulImports) 条数据"
            print(importMessage)
            
            // 使用DispatchQueue.main.async确保在主线程上更新UI
            DispatchQueue.main.async {
                // 关闭进度提示框
                showProgressAlert = false
                
                // 显示成功提示
                let alert = UIAlertController(title: "导入成功", message: importMessage, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                // 获取当前视图控制器并显示alert
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
            
            // 保存前10条导入的数据预览
            var previewData: [String] = []
            
            // 尝试从多个可能的实体中获取数据
            let possibleEntities = ["Parts", "Parts_categories", "Elements", "Inventory_parts", "Part_relationships"]
            
            for entityName in possibleEntities {
                // 先检查实体是否存在
                guard NSEntityDescription.entity(forEntityName: entityName, in: parentContext) != nil else {
                    print("实体\(entityName)不存在于数据模型中，跳过")
                    continue
                }
                
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: entityName)
                fetchRequest.fetchLimit = 10
                
                // 尝试添加排序，优先显示有ID的记录
                if entityName == "Parts" {
                    // 为Parts实体按part_num排序
                    let sortDescriptor = NSSortDescriptor(key: "part_num", ascending: true)
                    fetchRequest.sortDescriptors = [sortDescriptor]
                } else if entityName == "Parts_categories" || entityName == "Colors" {
                    // 为分类和颜色实体按id排序
                    let sortDescriptor = NSSortDescriptor(key: "id", ascending: true)
                    fetchRequest.sortDescriptors = [sortDescriptor]
                } else if entityName == "Inventory_parts" {
                    // 为Inventory_parts实体按inventory_id排序
                    let sortDescriptor = NSSortDescriptor(key: "inventory_id", ascending: true)
                    fetchRequest.sortDescriptors = [sortDescriptor]
                }
                
                do {
                    let entities = try parentContext.fetch(fetchRequest)
                    if !entities.isEmpty {
                        print("从\(entityName)实体获取预览数据，共\(entities.count)条")
                        
                        for entity in entities {
                            // 根据实体类型获取不同的字段
                            var displayText: String
                            
                            switch entityName {
                            case "Parts":
                                let partNum = entity.value(forKey: "part_num") as? String ?? ""
                                let name = entity.value(forKey: "name") as? String ?? ""
                                displayText = "\(entityName): \(partNum.isEmpty ? "未知" : partNum) - \(name.isEmpty ? "未知" : name)"
                            case "Parts_categories":
                                let id = entity.value(forKey: "id") as? Int32 ?? 0
                                let name = entity.value(forKey: "name") as? String ?? ""
                                displayText = "\(entityName): ID=\(id) - \(name)"
                            case "Colors":
                                let id = entity.value(forKey: "id") as? Int32 ?? 0
                                let name = entity.value(forKey: "name") as? String ?? ""
                                displayText = "\(entityName): ID=\(id) - \(name)"
                            case "Elements":
                                let elementId = entity.value(forKey: "element_id") as? Int32 ?? 0
                                let partNum = entity.value(forKey: "part_num") as? String ?? ""
                                displayText = "\(entityName): ID=\(elementId) - Part=\(partNum)"
                            case "Inventory_parts":
                                let inventoryId = entity.value(forKey: "inventory_id") as? Int32 ?? 0
                                let partNum = entity.value(forKey: "part_num") as? String ?? ""
                                let quantity = entity.value(forKey: "quantity") as? Int32 ?? 0
                                displayText = "\(entityName): Inv=\(inventoryId) - Part=\(partNum) - Qty=\(quantity)"
                            case "Part_relationships":
                                let parentPart = entity.value(forKey: "parent_part_num") as? String ?? ""
                                let childPart = entity.value(forKey: "child_part_num") as? String ?? ""
                                displayText = "\(entityName): Parent=\(parentPart) → Child=\(childPart)"
                            default:
                                let id = entity.value(forKey: "id") as? Int32 ?? 0
                                let name = entity.value(forKey: "name") as? String ?? ""
                                displayText = "\(entityName): ID=\(id) - \(name)"
                            }
                            
                            previewData.append(displayText)
                        }
                        
                        if !previewData.isEmpty {
                            break // 找到数据后停止尝试其他实体
                        }
                    }
                } catch {
                    print("从\(entityName)实体获取数据失败: \(error)")
                    // 继续尝试其他实体
                }
            }
            
            // 如果没有找到零件数据，尝试获取颜色数据
            if previewData.isEmpty {
                let colorEntity = "Colors"
                
                // 先检查实体是否存在
                let parentContext = PersistenceController.shared.rbContainer.viewContext
                if NSEntityDescription.entity(forEntityName: colorEntity, in: parentContext) != nil {
                    let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: colorEntity)
                    fetchRequest.fetchLimit = 10
                    
                    // 添加排序
                    let sortDescriptor = NSSortDescriptor(key: "id", ascending: true)
                    fetchRequest.sortDescriptors = [sortDescriptor]
                    
                    do {
                        let entities = try parentContext.fetch(fetchRequest)
                        if !entities.isEmpty {
                            print("从\(colorEntity)实体获取预览数据，共\(entities.count)条")
                            
                            for entity in entities {
                                let colorId = entity.value(forKey: "id") as? Int32 ?? 0
                                let name = entity.value(forKey: "name") as? String ?? ""
                                
                                previewData.append("\(colorEntity): ID=\(colorId) - \(name)")
                            }
                        }
                    } catch {
                        print("从\(colorEntity)实体获取数据失败: \(error)")
                    }
                } else {
                    print("实体\(colorEntity)不存在于数据模型中，跳过")
                }
            }
            
            // 如果仍然没有数据，添加一个提示
            if previewData.isEmpty {
                previewData.append("暂无导入数据")
            }
            
            // 在主线程上更新UI状态变量
            DispatchQueue.main.async {
                rbImportedData = previewData
                isImporting = false
            }
        }
    }
    
    private func processCSVFile(_ urls: [URL]) {
        // 处理CSV文件并显示数据预览
        csvData = []
        
        for url in urls {
            print("处理CSV文件: \(url.lastPathComponent)")
            
            // 对于安全范围URL，我们需要使用startAccessingSecurityScopedResource
            var shouldReleaseAccess = false
            
            // 尝试获取安全范围URL的访问权限
            if url.startAccessingSecurityScopedResource() {
                shouldReleaseAccess = true
                print("✅ 成功获取安全范围URL的访问权限")
            } else {
                print("⚠️ 无法获取安全范围URL的访问权限，尝试在没有访问权限的情况下读取")
            }
            
            // 使用defer语句确保无论是否发生错误都会释放访问权限
            defer {
                if shouldReleaseAccess {
                    url.stopAccessingSecurityScopedResource()
                    print("释放安全范围URL的访问权限")
                }
            }
            
            // 尝试读取CSV文件内容
            do {
                let content = try String(contentsOf: url, encoding: .utf8)
                let rows = CSVImporter.shared.parseCSVContent(content)
                
                // 显示前20行数据
                let maxRows = min(20, rows.count)
                for i in 0..<maxRows {
                    let row = rows[i]
                    let rowText = row.joined(separator: ", ")
                    csvData.append(rowText)
                }
                
                if rows.count > 20 {
                    csvData.append("... 更多数据未显示 ...")
                }
                
                showCSVData.toggle()
            } catch {
                print("读取CSV文件失败: \(error)")
                importError = "读取CSV文件失败: \(error.localizedDescription)"
            }
        }
    }
    
    private func checkPartCategories() {
        // 实现类别检查功能
        print("开始检查零件类别")
        
        // 创建一个新的私有队列上下文用于查询，避免线程安全问题
        let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        privateContext.parent = PersistenceController.shared.rbContainer.viewContext
        
        privateContext.performAndWait {
            // 从RB数据库中获取所有零件
            let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
            partsFetchRequest.fetchLimit = 100 // 限制检查数量，避免性能问题
            
            do {
                let parts = try privateContext.fetch(partsFetchRequest)
                print("找到 \(parts.count) 个零件")
                
                // 检查每个零件的类别
                for part in parts {
                    let partNum = part.value(forKey: "part_num") as? String ?? ""
                    let categoryId = part.value(forKey: "part_cat_id") as? Int32 ?? 0
                    
                    print("零件 \(partNum) 的类别ID: \(categoryId)")
                }
                
                // 显示检查完成提示
                DispatchQueue.main.async {
                    let alert = UIAlertController(title: "检查完成", message: "已检查 \(parts.count) 个零件的类别", preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "确定", style: .default))
                    
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let rootViewController = windowScene.windows.first?.rootViewController {
                        rootViewController.present(alert, animated: true)
                    }
                }
            } catch {
                print("检查零件类别失败: \(error)")
                
                // 显示检查失败提示
                DispatchQueue.main.async {
                    let alert = UIAlertController(title: "检查失败", message: "检查零件类别失败: \(error.localizedDescription)", preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "确定", style: .default))
                    
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let rootViewController = windowScene.windows.first?.rootViewController {
                        rootViewController.present(alert, animated: true)
                    }
                }
            }
        }
    }
    
    private func startInitDatabaseProcess() {
        // 开始初始化数据库流程
        requestPassword()
    }
    
    private func requestPassword() {
        // 实现密码请求功能
        let alert = UIAlertController(title: "输入密码", message: "请输入管理员密码以初始化数据库", preferredStyle: .alert)
        
        alert.addTextField { textField in
            textField.placeholder = "请输入密码"
            textField.isSecureTextEntry = true
        }
        
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
            if let password = alert.textFields?.first?.text {
                if password == "22332468" { // 简单密码验证
                    self.firstConfirmation()
                } else {
                    // 密码错误提示
                    let errorAlert = UIAlertController(title: "密码错误", message: "请输入正确的管理员密码", preferredStyle: .alert)
                    errorAlert.addAction(UIAlertAction(title: "确定", style: .default))
                    
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let rootViewController = windowScene.windows.first?.rootViewController {
                        rootViewController.present(errorAlert, animated: true)
                    }
                }
            }
        })
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            rootViewController.present(alert, animated: true)
        }
    }
    
    private func firstConfirmation() {
        // 第一次确认
        let alert = UIAlertController(title: "确认初始化", message: "初始化数据库将删除所有现有数据，确定要继续吗？", preferredStyle: .alert)
        
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "确定", style: .destructive) { _ in
            self.secondConfirmation()
        })
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            rootViewController.present(alert, animated: true)
        }
    }
    
    private func secondConfirmation() {
        // 第二次确认
        let alert = UIAlertController(title: "再次确认", message: "此操作不可撤销，所有数据将被删除，确定要继续吗？", preferredStyle: .alert)
        
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "确定", style: .destructive) { _ in
            self.thirdConfirmation()
        })
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            rootViewController.present(alert, animated: true)
        }
    }
    
    private func thirdConfirmation() {
        // 第三次确认
        let alert = UIAlertController(title: "最终确认", message: "最后一次确认，所有数据将被删除并重新初始化，确定要执行吗？", preferredStyle: .alert)
        
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "确定", style: .destructive) { _ in
            // 执行初始化操作
            self.initDatabase()
        })
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            rootViewController.present(alert, animated: true)
        }
    }
}
