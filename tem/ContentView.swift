//
//  ContentView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/13.
//

import SwiftUI
import CoreData
import UIKit
import Foundation
import UniformTypeIdentifiers



// Note: All view implementations are in separate files

// 自定义键盘固定修饰符
struct KeyboardFixedModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .ignoresSafeArea()
            .ignoresSafeArea(.keyboard)
    }
}

// UIView扩展，用于获取父视图控制器
extension UIView {
    func asViewController() -> UIViewController? {
        var responder: UIResponder? = self
        while responder != nil {
            if let vc = responder as? UIViewController {
                return vc
            }
            responder = responder?.next
        }
        return nil
    }
}

// 主视图结构


struct ContentView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @State private var currentState: ViewState = .main
    @State private var selectedRepository: NSManagedObject?
    @State private var selectedBox: NSManagedObject?
    @State private var selectedPart: NSManagedObject?
    @State private var lastRepositoryId: Int32? = UserDefaults.standard.object(forKey: "lastRepositoryId") as? Int32
    @State private var showExitConfirmAlert: Bool = false

    var body: some View {
        ZStack {
            // 背景
            Color(red: 0xF2/255, green: 0xCD/255, blue: 0x37/255)
                .edgesIgnoringSafeArea(.all)
            
            GeometryReader { geometry in
                ZStack {
                    // 视图二：次页面（占比7/8）- 放在底层
                    ViewTwo(currentState: $currentState, selectedRepository: $selectedRepository, selectedBox: $selectedBox, selectedPart: $selectedPart, lastRepositoryId: $lastRepositoryId, showExitConfirmAlert: $showExitConfirmAlert)
                        .frame(width: geometry.size.width, height: geometry.size.height * 7/8)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 8 + geometry.size.height * 7/16)
                    
                    // 视图一：主页面（占比1/8）- 放在上层
                    ViewOne(currentState: $currentState, lastRepositoryId: $lastRepositoryId, showExitConfirmAlert: $showExitConfirmAlert)
                        .frame(width: geometry.size.width, height: geometry.size.height / 8)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 16)
                        .zIndex(10) // 确保视图一始终在最上层
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
            }
            .ignoresSafeArea()
            .ignoresSafeArea(.keyboard) // 忽略键盘影响
        }
    }
}

// 视图一：主页面，包含四个按钮
struct ViewOne: View {
    @Binding var currentState: ViewState
    @Binding var lastRepositoryId: Int32?
    @Binding var showExitConfirmAlert: Bool
    @Environment(\.managedObjectContext) private var viewContext
    
    // LOGO图片状态
    @State private var logoImage: UIImage?
    @State private var showImagePicker: Bool = false
    @State private var selectedImagePath: String? = nil
    @State private var showConfirmSheet: Bool = false
    @State private var isLogoImageSelection: Bool = false
    
    // 按钮图片状态
    @State private var repoButtonImage: UIImage?
    @State private var searchButtonImage: UIImage?
    @State private var settingsButtonImage: UIImage?
    @State private var exitButtonImage: UIImage?
    @State private var currentButtonForImage: String? = nil
    @State private var selectedButtonImage: UIImage? = nil
    
    // 缓存文件夹路径
    private var cacheDirectory: URL {
        let urls = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        return urls[0].appendingPathComponent("LOGO")
    }
    
    // 按钮图片缓存路径
    private var buttonCacheDirectory: URL {
        let urls = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        return urls[0].appendingPathComponent("BUTTONS")
    }
    


    var body: some View {
        GeometryReader { geometry in
            let containerWidth = geometry.size.width * 0.96
            let containerHeight = geometry.size.height * 0.9 // 容器高度为视图一高度的90%
            
            VStack(spacing: 0) {
                Spacer()
                
                // 主容器
                HStack {
                    Spacer()
                    
                    VStack(spacing: 0) {
                        // 标题栏 - 容器的中央往右50点，顶边对齐logo的顶边
                        HStack {
                            Spacer()
                            Text("顺德乐高玩具专卖店-零件库")
                                .font(.system(size: 28, weight: .bold))  // 调整字体大小
                                .multilineTextAlignment(.center)
                                .offset(x: 50, y: 20) // 往下移动20点
                            Spacer()
                        }
                        
                        // 主要内容区域：LOGO 和按钮
                        HStack(alignment: .bottom, spacing: 24) {
                            // 左边LOGO
                            ZStack {
                                if let image = logoImage {
                                    Image(uiImage: image)
                                        .resizable()
                                        .aspectRatio(1, contentMode: .fit)
                                        .frame(width: 100, height: 100)
                                } else {
                                    // 尝试从缓存加载LOGO
                                    let logoCachePath = cacheDirectory.appendingPathComponent("logo.png")
                                    if let cachedImage = UIImage(contentsOfFile: logoCachePath.path) {
                                        Image(uiImage: cachedImage)
                                            .resizable()
                                            .aspectRatio(1, contentMode: .fit)
                                            .frame(width: 100, height: 100)
                                    } else {
                                        // 尝试使用绝对路径加载默认图片
                                        let absolutePath = "/Users/legoping/Library/CloudStorage/OneDrive-个人(2)/SDLEGO/PARTS/PARTS/images/"
                                        if let defaultImage = UIImage(contentsOfFile: absolutePath + "LOGO.PNP") {
                                            Image(uiImage: defaultImage)
                                                .resizable()
                                                .aspectRatio(1, contentMode: .fit)
                                                .frame(width: 100, height: 100)
                                        } else {
                                            // 显示占位符
                                            Text("LOGO")
                                                .font(.system(size: 20, weight: .bold))
                                                .padding()
                                                .background(Color.blue)
                                                .foregroundColor(.white)
                                                .frame(width: 100, height: 100)
                                        }
                                    }
                                }
                            }
                            .simultaneousGesture(
                            LongPressGesture(minimumDuration: 2.0)
                                .onEnded { _ in
                                    isLogoImageSelection = true
                                    showImagePicker = true
                                }
                        )
                            
                            // 中间空间
                            Spacer()
                            
                            // 按钮栏 - 依次靠右边
                            HStack(spacing: 2) {  // 调整按钮间距
                                // 仓库管理按钮
                                Button(action: {
                                    // 检查是否有记忆的仓库ID
                                    if let lastId = lastRepositoryId {
                                        // 尝试获取对应ID的仓库
                                        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
                                        fetchRequest.predicate = NSPredicate(format: "id == %d", lastId)
                                        do {
                                            let repositories = try viewContext.fetch(fetchRequest)
                                            if let repository = repositories.first {
                                                // 直接进入盒子管理页面
                                                currentState = .boxManagement(repository)
                                                return
                                            }
                                        } catch {
                                            print("Error fetching repository: \(error)")
                                        }
                                    }
                                    // 如果没有记忆的仓库或获取失败，进入仓库管理页面
                                    currentState = .repositoryManagement
                                }) {
                                    ZStack(alignment: .bottom) {
                                        if let image = repoButtonImage {
                                            Image(uiImage: image)
                                                .resizable()
                                                .aspectRatio(contentMode: .fit)
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        } else {
                                            // 默认背景
                                            Color.blue
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        }
                                        Text("仓库管理")
                                            .font(.system(size: 22, weight: .bold)) // 文字大小22点
                                            .foregroundColor(.white)
                                            .padding(.bottom, 12) // 文字底边距离按钮底边12点
                                    }
                                    .fixedSize(horizontal: true, vertical: false)
                                }
                                .simultaneousGesture(
                                    LongPressGesture(minimumDuration: 2.0)
                                        .onEnded { _ in
                                            currentButtonForImage = "repo"
                                            isLogoImageSelection = false
                                            showImagePicker = true
                                        }
                                )

                                // 零件搜索按钮
                                Button(action: {
                                    // 重置搜索页面和搜索结果页面
                                    // 清除搜索相关的用户默认值
                                    UserDefaults.standard.removeObject(forKey: "searchPartNumber")
                                    UserDefaults.standard.removeObject(forKey: "searchKeyword")
                                    UserDefaults.standard.removeObject(forKey: "searchCategory")
                                    UserDefaults.standard.removeObject(forKey: "searchColor")
                                    UserDefaults.standard.synchronize()
                                    
                                    // 进入搜索页面
                                    currentState = .search
                                }) {
                                    ZStack(alignment: .bottom) {
                                        if let image = searchButtonImage {
                                            Image(uiImage: image)
                                                .resizable()
                                                .aspectRatio(contentMode: .fit)
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        } else {
                                            // 默认背景
                                            Color.green
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        }
                                        Text("零件搜索")
                                            .font(.system(size: 22, weight: .bold)) // 文字大小22点
                                            .foregroundColor(.white)
                                            .padding(.bottom, 12) // 文字底边距离按钮底边12点
                                    }
                                    .fixedSize(horizontal: true, vertical: false)
                                }
                                .simultaneousGesture(
                                    LongPressGesture(minimumDuration: 2.0)
                                        .onEnded { _ in
                                            currentButtonForImage = "search"
                                            isLogoImageSelection = false
                                            showImagePicker = true
                                        }
                                )

                                // 系统设置按钮
                                Button(action: {
                                    currentState = .settings
                                }) {
                                    ZStack(alignment: .bottom) {
                                        if let image = settingsButtonImage {
                                            Image(uiImage: image)
                                                .resizable()
                                                .aspectRatio(contentMode: .fit)
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        } else {
                                            // 默认背景
                                            Color.orange
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        }
                                        Text("系统设置")
                                            .font(.system(size: 22, weight: .bold)) // 文字大小22点
                                            .foregroundColor(.white)
                                            .padding(.bottom, 12) // 文字底边距离按钮底边12点
                                    }
                                    .fixedSize(horizontal: true, vertical: false)
                                }
                                .simultaneousGesture(
                                    LongPressGesture(minimumDuration: 2.0)
                                        .onEnded { _ in
                                            currentButtonForImage = "settings"
                                            isLogoImageSelection = false
                                            showImagePicker = true
                                        }
                                )

                                // 退出按钮
                                Button(action: {
                                    // 显示退出确认弹窗
                                    showExitConfirmAlert = true
                                }) {
                                    ZStack(alignment: .bottom) {
                                        if let image = exitButtonImage {
                                            Image(uiImage: image)
                                                .resizable()
                                                .aspectRatio(contentMode: .fit)
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        } else {
                                            // 默认背景
                                            Color.red
                                                .frame(height: 58.2) // 按钮高度58.2点
                                        }
                                        Text("退出")
                                            .font(.system(size: 22, weight: .bold)) // 文字大小22点
                                            .foregroundColor(.white)
                                            .padding(.bottom, 12) // 文字底边距离按钮底边12点
                                    }
                                    .fixedSize(horizontal: true, vertical: false)
                                }
                                .simultaneousGesture(
                                    LongPressGesture(minimumDuration: 2.0)
                                        .onEnded { _ in
                                            currentButtonForImage = "exit"
                                            isLogoImageSelection = false
                                            showImagePicker = true
                                        }
                                )
                            }
                        }
                    }
                    .frame(width: containerWidth, height: containerHeight)
                    
                    Spacer()
                }
                
                // 容器底边距离视图一底边5点
                Spacer(minLength: 5)
            }
            .background(Color(red: 0xF2/255, green: 0xCD/255, blue: 0x37/255))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear {
                // 检查Bundle资源路径
                print("Bundle.main.resourcePath: \(Bundle.main.resourcePath ?? "nil")")
                
                // 检查images文件夹是否存在
                if let imagesPath = Bundle.main.resourcePath?.appending("/images") {
                    print("images文件夹路径: \(imagesPath)")
                    
                    // 检查路径是否存在
                    if FileManager.default.fileExists(atPath: imagesPath) {
                        print("images文件夹存在")
                        
                        // 列出文件夹中的所有文件
                        do {
                            let files = try FileManager.default.contentsOfDirectory(atPath: imagesPath)
                            print("images文件夹中的文件: \(files)")
                            
                            // 尝试加载每个文件
                            for file in files {
                                print("尝试加载文件: \(file)")
                                let filePath = imagesPath.appending("/").appending(file)
                                if UIImage(contentsOfFile: filePath) != nil {
                                    print("成功加载文件: \(file)")
                                } else {
                                    print("加载文件失败: \(file)")
                                }
                            }
                        } catch {
                            print("列出文件夹内容失败: \(error)")
                        }
                    } else {
                        print("images文件夹不存在")
                    }
                } else {
                    print("无法获取images文件夹路径")
                }
                
                // 尝试直接使用文件名加载（不指定subdirectory）
                print("\n尝试直接使用文件名加载:")
                if UIImage(named: "logo") != nil {
                    print("成功加载logo图片")
                } else if UIImage(named: "LOGO") != nil {
                    print("成功加载LOGO图片")
                } else if UIImage(named: "img000") != nil {
                    print("成功加载img000图片")
                } else {
                    print("所有直接加载尝试失败")
                }
            }
        }
        .sheet(isPresented: $showImagePicker) {
            NavigationView {
                ImagePicker(selectedImage: isLogoImageSelection ? $logoImage : $selectedButtonImage, isPresented: $showImagePicker, selectedImagePath: $selectedImagePath, showConfirmSheet: $showConfirmSheet)
                    .navigationBarTitle("选择图片", displayMode: .inline)
                    .navigationBarItems(trailing: Button("取消") {
                        showImagePicker = false
                    })
            }
        }
        .sheet(isPresented: $showConfirmSheet) {
            VStack(spacing: 20) {
                Text(currentButtonForImage != nil ? "确认替换按钮图片" : "确认替换LOGO")
                    .font(.system(size: 20, weight: .bold))
                    .padding(.top, 10)
                
                if let path = selectedImagePath {
                    Text("图片路径:")
                        .font(.system(size: 16, weight: .bold))
                    Text(path)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 20)
                        .multilineTextAlignment(.center)
                }
                
                if let image = currentButtonForImage != nil ? selectedButtonImage : logoImage {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 100, height: 100)
                        .padding(20)
                }
                
                HStack(spacing: 20) {
                    Button(action: {
                        showConfirmSheet = false
                        if currentButtonForImage != nil {
                            selectedButtonImage = nil
                            currentButtonForImage = nil
                        } else {
                            logoImage = nil
                        }
                        selectedImagePath = nil
                        isLogoImageSelection = false
                    }) {
                        Text("取消")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 12)
                            .background(Color.gray)
                            .cornerRadius(10)
                    }
                    Button(action: {
                        if let button = currentButtonForImage, let image = selectedButtonImage {
                            saveButtonImageToCache(image, forButton: button)
                        } else if let image = logoImage {
                            saveLogoImageToCache(image)
                        }
                        showConfirmSheet = false
                        selectedButtonImage = nil
                        logoImage = nil
                        selectedImagePath = nil
                        currentButtonForImage = nil
                        isLogoImageSelection = false
                    }) {
                        Text("确认")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 12)
                            .background(Color.blue)
                            .cornerRadius(10)
                    }
                }
            }
            .padding(30)
            .frame(maxWidth: 500)
        }
        .onAppear {
            // 尝试从缓存加载LOGO
            loadLogoFromCache()
            // 尝试从缓存加载按钮图片
            loadButtonImagesFromCache()
        }
    }
    
    // 从缓存加载LOGO
    private func loadLogoFromCache() {
        // 确保缓存目录存在
        do {
            try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        } catch {
            print("创建缓存目录失败: \(error)")
        }
        
        // 缓存中的LOGO路径
        let logoCachePath = cacheDirectory.appendingPathComponent("logo.png")
        
        // 尝试加载缓存中的LOGO
        if let cachedImage = UIImage(contentsOfFile: logoCachePath.path) {
            logoImage = cachedImage
            print("从缓存加载LOGO成功")
        }
    }
    
    // 保存LOGO到缓存
    private func saveLogoImageToCache(_ image: UIImage) {
        // 确保缓存目录存在
        do {
            try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        } catch {
            print("创建缓存目录失败: \(error)")
            return
        }
        
        // 缓存中的LOGO路径
        let logoCachePath = cacheDirectory.appendingPathComponent("logo.png")
        
        // 保存图片到缓存
        if let data = image.pngData() {
            do {
                try data.write(to: logoCachePath)
                print("保存LOGO到缓存成功: \(logoCachePath.path)")
            } catch {
                print("保存LOGO到缓存失败: \(error)")
            }
        }
    }
    
    // 从缓存加载按钮图片
    private func loadButtonImagesFromCache() {
        // 确保按钮缓存目录存在
        do {
            try FileManager.default.createDirectory(at: buttonCacheDirectory, withIntermediateDirectories: true)
        } catch {
            print("创建按钮缓存目录失败: \(error)")
        }
        
        // 加载仓库管理按钮图片
        let repoButtonPath = buttonCacheDirectory.appendingPathComponent("repo_button.png")
        if let cachedImage = UIImage(contentsOfFile: repoButtonPath.path) {
            repoButtonImage = cachedImage
            print("从缓存加载仓库管理按钮图片成功")
        }
        
        // 加载零件搜索按钮图片
        let searchButtonPath = buttonCacheDirectory.appendingPathComponent("search_button.png")
        if let cachedImage = UIImage(contentsOfFile: searchButtonPath.path) {
            searchButtonImage = cachedImage
            print("从缓存加载零件搜索按钮图片成功")
        }
        
        // 加载系统设置按钮图片
        let settingsButtonPath = buttonCacheDirectory.appendingPathComponent("settings_button.png")
        if let cachedImage = UIImage(contentsOfFile: settingsButtonPath.path) {
            settingsButtonImage = cachedImage
            print("从缓存加载系统设置按钮图片成功")
        }
        
        // 加载退出按钮图片
        let exitButtonPath = buttonCacheDirectory.appendingPathComponent("exit_button.png")
        if let cachedImage = UIImage(contentsOfFile: exitButtonPath.path) {
            exitButtonImage = cachedImage
            print("从缓存加载退出按钮图片成功")
        }
    }
    
    // 保存按钮图片到缓存
    private func saveButtonImageToCache(_ image: UIImage, forButton button: String) {
        // 确保按钮缓存目录存在
        do {
            try FileManager.default.createDirectory(at: buttonCacheDirectory, withIntermediateDirectories: true)
        } catch {
            print("创建按钮缓存目录失败: \(error)")
            return
        }
        
        // 确定缓存文件路径
        let buttonPath: URL
        switch button {
        case "repo":
            buttonPath = buttonCacheDirectory.appendingPathComponent("repo_button.png")
        case "search":
            buttonPath = buttonCacheDirectory.appendingPathComponent("search_button.png")
        case "settings":
            buttonPath = buttonCacheDirectory.appendingPathComponent("settings_button.png")
        case "exit":
            buttonPath = buttonCacheDirectory.appendingPathComponent("exit_button.png")
        default:
            return
        }
        
        // 保存图片到缓存
        if let data = image.pngData() {
            do {
                try data.write(to: buttonPath)
                print("保存\(button)按钮图片到缓存成功: \(buttonPath.path)")
                
                // 更新按钮图片状态
                switch button {
                case "repo":
                    repoButtonImage = image
                case "search":
                    searchButtonImage = image
                case "settings":
                    settingsButtonImage = image
                case "exit":
                    exitButtonImage = image
                default:
                    break
                }
            } catch {
                print("保存按钮图片到缓存失败: \(error)")
            }
        }
    }
}

// 视图二：次页面，根据当前状态显示不同内容
struct ViewTwo: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    @Binding var selectedRepository: NSManagedObject?
    @Binding var selectedBox: NSManagedObject?
    @Binding var selectedPart: NSManagedObject?
    @Binding var lastRepositoryId: Int32?
    @Binding var showExitConfirmAlert: Bool
    
    // 跟踪上一个页面状态，用于返回
    @State private var previousState: ViewState?
    
    // 初始化方法
    init(currentState: Binding<ViewState>, selectedRepository: Binding<NSManagedObject?>, selectedBox: Binding<NSManagedObject?>, selectedPart: Binding<NSManagedObject?>, lastRepositoryId: Binding<Int32?>, showExitConfirmAlert: Binding<Bool>) {
        self._currentState = currentState
        self._selectedRepository = selectedRepository
        self._selectedBox = selectedBox
        self._selectedPart = selectedPart
        self._lastRepositoryId = lastRepositoryId
        self._showExitConfirmAlert = showExitConfirmAlert
        // 不在这里创建搜索视图实例，而是在需要时创建
    }

    var body: some View {
        ZStack {
            // 基础页面 - 始终显示当前状态对应的页面
            // 当状态是.partDetail时，我们不改变显示，只是在浮层显示详情页面
            // 这样可以保持搜索结果页面的状态
            
            // 只有当状态不是.partDetail时，才根据currentState显示页面
            // 当状态是.partDetail时，保持显示上一个页面
            if case .partDetail = currentState {
                // 当显示零件详情时，显示上一个状态对应的页面
                if let prevState = previousState {
                    switch prevState {
                    case .main:
                        MainPage()
                    case .repositoryManagement:
                        RepositoryManagementView(currentState: $currentState, selectedRepository: $selectedRepository, lastRepositoryId: $lastRepositoryId)
                    case .boxManagement(_):
                        // 重定向到仓库管理页面，不再使用单独的盒子管理页面
                        RepositoryManagementView(currentState: $currentState, selectedRepository: $selectedRepository, lastRepositoryId: $lastRepositoryId)
                    case .partManagement(let box):
                        PartManagementView(currentState: $currentState, box: box, selectedPart: $selectedPart)
                    case .addPart(let box):
                        AddPartView(currentState: $currentState, box: box)
                    case .search:
                            // 直接使用搜索视图实例
                            SearchViewWrapper(currentState: $currentState, viewContext: viewContext)
                    case .searchWithPartNumber:
                            // 直接使用搜索视图实例
                            SearchViewWrapper(currentState: $currentState, viewContext: viewContext)
                    case .settings:
                        SettingsView()
                    case .colorManagement:
                        ColorManagementView(currentState: $currentState)
                    case .partDetail:
                        // 避免递归，显示主页面
                        MainPage()
                    }
                } else {
                    // 默认显示主页面
                    MainPage()
                }
            } else {
                // 其他状态正常显示
                switch currentState {
                case .main:
                    MainPage()
                case .repositoryManagement:
                    RepositoryManagementView(currentState: $currentState, selectedRepository: $selectedRepository, lastRepositoryId: $lastRepositoryId)
                case .boxManagement(let repository):
                    // 重定向到仓库管理页面，不再使用单独的盒子管理页面
                    RepositoryManagementView(currentState: $currentState, selectedRepository: $selectedRepository, lastRepositoryId: $lastRepositoryId)
                        .onAppear {
                            // 选择该仓库
                            selectedRepository = repository
                            // 更新lastRepositoryId
                            if let repoId = repository.value(forKey: "id") as? Int32 {
                                lastRepositoryId = repoId
                                UserDefaults.standard.set(repoId, forKey: "lastRepositoryId")
                            }
                        }
                case .partManagement(let box):
                    PartManagementView(currentState: $currentState, box: box, selectedPart: $selectedPart)
                case .addPart(let box):
                    AddPartView(currentState: $currentState, box: box)
                case .search:
                    // 直接使用搜索视图实例
                    SearchViewWrapper(currentState: $currentState, viewContext: viewContext)
                case .searchWithPartNumber(let partNumber):
                    // 直接使用搜索视图实例
                    SearchViewWrapper(currentState: $currentState, viewContext: viewContext)
                        .onAppear {
                            print("Setting searchPartNumber in UserDefaults: \(partNumber)")
                            // 先清除旧值，再设置新值
                            UserDefaults.standard.removeObject(forKey: "searchPartNumber")
                            // 当进入搜索页面时，设置搜索条件到UserDefaults
                            UserDefaults.standard.set(partNumber, forKey: "searchPartNumber")
                            print("Current searchPartNumber in UserDefaults: \(UserDefaults.standard.string(forKey: "searchPartNumber") ?? "nil")")
                        }
                case .settings:
                    SettingsView()
                case .colorManagement:
                    ColorManagementView(currentState: $currentState)
                case .partDetail:
                    // 这里不会执行，因为已经在上面处理了
                    EmptyView()
                }
            }
            
            // 浮层视图 - 零件详情
            if case .partDetail(let part) = currentState {
                // 半透明背景
                Color.black.opacity(0.3)
                    .edgesIgnoringSafeArea(.all)
                    .onTapGesture {
                        // 点击背景关闭详情页面
                        if let prevState = previousState {
                            currentState = prevState
                        } else if let box = part.value(forKey: "box") as? NSManagedObject {
                            currentState = .partManagement(box)
                        } else {
                            currentState = .repositoryManagement
                        }
                    }
                
                // 零件详情页面
                PartDetailView(currentState: $currentState, part: part, previousState: $previousState)
            }
            
            // 退出确认视图 - 放在视图二的右上角
            if showExitConfirmAlert {
                VStack {
                    HStack {
                        Spacer()
                        VStack(alignment: .center, spacing: 20) {
                            Text("确定要退出吗？")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.black)
                                .multilineTextAlignment(.center)
                            HStack(spacing: 20) {
                                Button(action: {
                                    showExitConfirmAlert = false
                                }) {
                                    Text("取消")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 24)
                                        .padding(.vertical, 10)
                                        .background(Color.blue)
                                        .cornerRadius(8)
                                }
                                Button(action: {
                                    // 实现退出功能
                                    exit(0)
                                }) {
                                    Text("确认")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 24)
                                        .padding(.vertical, 10)
                                        .background(Color.red)
                                        .cornerRadius(8)
                                }
                            }
                        }
                        .padding(24)
                        .background(Color.white)
                        .cornerRadius(12)
                        .shadow(radius: 10)
                        .padding(20) // 调整与右上角的距离
                    }
                    Spacer()
                }
            }
        }
        .ignoresSafeArea(.keyboard) // 忽略键盘影响
        .onChange(of: currentState) { oldValue, newValue in
            // 当状态变为partDetail时，记录上一个状态
            if case .partDetail = newValue {
                if case .partDetail = oldValue {
                    // 已经是partDetail状态，不需要记录
                } else {
                    previousState = oldValue
                }
            }
        }
    }
}

// 主页面内容
struct MainPage: View {
    var body: some View {
        VStack {
            Text("欢迎使用零件管理系统")
                .font(.system(size: 24, weight: .bold))
                .padding()
            Text("请从上方选择操作")
                .font(.system(size: 18))
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
    }
}

// Note: All view implementations have been moved to separate files
// The forward declarations above ensure compatibility during compilation

// 搜索视图包装器，用于安全处理optional搜索视图实例
struct SearchViewWrapper: View {
    let currentState: Binding<ViewState>
    let viewContext: NSManagedObjectContext
    
    var body: some View {
        PartSearchView(currentState: currentState)
            .environment(\.managedObjectContext, viewContext)
    }
}

// 图片选择器
struct ImagePicker: UIViewControllerRepresentable {
    @Binding var selectedImage: UIImage?
    @Binding var isPresented: Bool
    @Binding var selectedImagePath: String?
    @Binding var showConfirmSheet: Bool
    
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ImagePicker
        
        init(_ parent: ImagePicker) {
            self.parent = parent
        }
        
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.selectedImage = image
            }
            // 获取图片路径
            if let imageURL = info[.imageURL] as? URL {
                parent.selectedImagePath = imageURL.path
            }
            parent.isPresented = false
            parent.showConfirmSheet = true
        }
        
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.isPresented = false
        }
    }
}



