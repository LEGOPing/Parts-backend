//
//  PartImageLoader.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/3/5.
//

import SwiftUI
import CoreData

// 基于零件型号和颜色ID的图片加载器
struct PartImageLoader: View {
    let partNum: String
    let colorId: Int32
    var onImgUrlUpdated: ((String?) -> Void)? = nil
    
    @State private var image: UIImage?
    @State private var isLoading = false
    @State private var dataTask: URLSessionDataTask? = nil
    
    var body: some View {
        ZStack {
            Group {
                if let image = image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    // 显示默认占位符图片
                    Color.gray.opacity(0.2)
                        .frame(width: 150, height: 150)
                        .cornerRadius(4)
                        .overlay(
                            Text(isLoading ? "加载中..." : "暂无图片")
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                                .multilineTextAlignment(.center)
                        )
                }
            }
        }
        .onAppear {
            print("PartImageLoader 视图出现，开始加载图片")
            loadImage()
        }
        .onChange(of: partNum) {
            print("零件型号变化，重新加载图片")
            loadImage()
        }
        .onChange(of: colorId) {
            print("颜色ID变化，重新加载图片")
            loadImage()
        }
    }
    
    // 缓存图片URL的结构
    private struct ImageUrlCache {
        static var cache: [String: String] = [:]
        
        static func getKey(partNum: String, colorId: Int32) -> String {
            return "\(partNum)_\(colorId)"
        }
        
        static func get(partNum: String, colorId: Int32) -> String? {
            let key = getKey(partNum: partNum, colorId: colorId)
            return cache[key]
        }
        
        static func set(partNum: String, colorId: Int32, url: String) {
            let key = getKey(partNum: partNum, colorId: colorId)
            cache[key] = url
        }
    }
    
    private func loadImage() {
        // 只在有零件型号的情况下才加载图片
        guard !partNum.isEmpty else {
            print("零件型号为空，不加载图片")
            isLoading = false
            image = nil
            return
        }
        
        print("开始加载图片")
        print("零件型号: \(partNum)")
        print("颜色ID: \(colorId)")
        
        // 开始加载新图片前，先将image设置为nil，显示加载状态
        image = nil
        isLoading = true
        
        // 首先尝试从本地缓存加载图片
        let cachedImage = loadCachedImage()
        if let cachedImage = cachedImage {
            print("从本地缓存加载图片成功: \(partNum)_, \(colorId).jpg")
            image = cachedImage
            isLoading = false
            print("设置image状态变量，应该显示图片")
            // 从缓存加载成功后，检查是否已有缓存的URL
            if let cachedUrl = ImageUrlCache.get(partNum: partNum, colorId: colorId) {
                print("使用缓存的图片URL: \(cachedUrl)")
                onImgUrlUpdated?(cachedUrl)
            } else {
                // 只有当没有缓存的URL时，才获取图片URL
                fetchImageUrl { urlString in
                    // 通知父视图图片URL已经更新
                    onImgUrlUpdated?(urlString)
                    print("获取到图片URL: \(urlString ?? "nil")")
                }
            }
        } else {
            print("缓存中无图片，从网络加载")
            // 缓存中无图片，获取图片URL并从网络加载
            fetchImageUrl { urlString in
                // 通知父视图图片URL已经更新
                onImgUrlUpdated?(urlString)
                print("获取到图片URL: \(urlString ?? "nil")")
                
                if let urlString = urlString, let url = URL(string: urlString) {
                    print("开始从网络加载图片: \(urlString)")
                    print("URL格式验证: 有效")
                    print("零件型号: \(partNum)")
                    print("颜色ID: \(colorId)")
                    
                    // 配置URLSession
                    let config = URLSessionConfiguration.default
                    config.timeoutIntervalForRequest = 15.0
                    config.timeoutIntervalForResource = 30.0
                    config.httpAdditionalHeaders = [
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                        "Accept": "image/*",
                        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
                    ]
                    config.requestCachePolicy = .reloadIgnoringLocalCacheData
                    let session = URLSession(configuration: config)
                    
                    // 取消之前的任务
                    self.dataTask?.cancel()
                    
                    print("准备发送网络请求")
                    print("请求URL: \(url.absoluteString)")
                    print("请求方法: GET")
                    
                    self.dataTask = session.dataTask(with: url) { data, response, error in
                        print("网络请求返回")
                        DispatchQueue.main.async {
                            print("网络请求完成")
                            self.isLoading = false
                            
                            if error != nil {
                                print("图片加载失败: \(error?.localizedDescription ?? "未知错误")")
                                print("错误代码: \(error?._code ?? -1)")
                                print("URL: \(urlString)")
                                print("零件型号: \(partNum)")
                                print("颜色ID: \(colorId)")
                                // 网络加载失败，显示"暂无图片"
                                print("网络加载失败，显示'暂无图片'")
                                // 设置image为nil，触发显示占位符
                                self.image = nil
                            } else if let httpResponse = response as? HTTPURLResponse {
                                print("HTTP状态码: \(httpResponse.statusCode)")
                                print("响应头: \(httpResponse.allHeaderFields)")
                                
                                if httpResponse.statusCode != 200 {
                                    print("图片加载失败，状态码: \(httpResponse.statusCode)")
                                    print("URL: \(urlString)")
                                    print("零件型号: \(partNum)")
                                    print("颜色ID: \(colorId)")
                                    // 网络加载失败，显示"暂无图片"
                                    print("网络加载失败，显示'暂无图片'")
                                    // 设置image为nil，触发显示占位符
                                    self.image = nil
                                } else if let data = data {
                                    print("响应数据大小: \(data.count) 字节")
                                    if let loadedImage = UIImage(data: data) {
                                        print("图片加载成功，大小: \(data.count) 字节")
                                        print("URL: \(urlString)")
                                        print("零件型号: \(partNum)")
                                        print("颜色ID: \(colorId)")
                                        print("设置image状态变量，应该显示图片")
                                        self.image = loadedImage
                                        // 保存图片到本地缓存
                                        self.saveImageToCache(image: loadedImage)
                                    } else {
                                        print("图片数据无效")
                                        print("URL: \(urlString)")
                                        print("零件型号: \(partNum)")
                                        print("颜色ID: \(colorId)")
                                        // 图片数据无效，显示"暂无图片"
                                        print("图片数据无效，显示'暂无图片'")
                                        // 设置image为nil，触发显示占位符
                                        self.image = nil
                                    }
                                } else {
                                    print("无响应数据")
                                    print("URL: \(urlString)")
                                    print("零件型号: \(partNum)")
                                    print("颜色ID: \(colorId)")
                                    // 无响应数据，显示"暂无图片"
                                    print("无响应数据，显示'暂无图片'")
                                    // 设置image为nil，触发显示占位符
                                    self.image = nil
                                }
                            } else {
                                print("无响应")
                                print("URL: \(urlString)")
                                print("零件型号: \(partNum)")
                                print("颜色ID: \(colorId)")
                                // 无响应，显示"暂无图片"
                                print("无响应，显示'暂无图片'")
                                // 设置image为nil，触发显示占位符
                                self.image = nil
                            }
                            self.dataTask = nil
                        }
                    }
                    
                    self.dataTask?.resume()
                } else {
                    print("图片URL为空或无效")
                    print("零件型号: \(partNum)")
                    print("颜色ID: \(colorId)")
                    // 没有有效的图片URL，显示"暂无图片"
                    print("没有有效的图片URL，显示'暂无图片'")
                    // 设置image为nil，触发显示占位符
                    self.isLoading = false
                    self.image = nil
                }
            }
        }
    }
    
    private func fetchImageUrl(completion: @escaping (String?) -> Void) {
        // 检查缓存是否有效
        if let cachedUrl = ImageUrlCache.get(partNum: partNum, colorId: colorId) {
            print("使用缓存的图片URL: \(cachedUrl)")
            completion(cachedUrl)
            return
        }
        
        // 从RB数据库的inventory_parts表中获取img_url
        print("开始从数据库获取图片URL")
        print("查询参数: part_num=\(partNum), color_id=\(colorId)")
        
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 直接使用persistence.rbContainer，因为它在PersistenceController中是非可选的
            let rbContainer = persistence.rbContainer
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = rbContainer.viewContext
            
            var fetchedUrl: String? = nil
            
            privateContext.performAndWait {
                // 首先从inventory_parts表中获取图片URL
                let inventoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Inventory_parts")
                inventoryFetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", partNum, colorId)
                
                do {
                    let inventoryParts = try privateContext.fetch(inventoryFetchRequest)
                    print("查询inventory_parts结果数量: \(inventoryParts.count)")
                    if let inventoryPart = inventoryParts.first {
                        print("找到inventory_parts记录")
                        // 检查Inventory_parts实体是否有img_url属性
                        let entity = inventoryPart.entity
                        if entity.attributesByName.keys.contains("img_url") {
                            fetchedUrl = inventoryPart.value(forKey: "img_url") as? String
                            print("从inventory_parts获取到img_url: \(fetchedUrl ?? "nil")")
                        } else {
                            print("Inventory_parts实体没有img_url属性")
                        }
                    } else {
                        print("未找到匹配的inventory_parts记录")
                    }
                } catch {
                    print("获取inventory_parts失败: \(error)")
                }
            }
            
            DispatchQueue.main.async {
                if let url = fetchedUrl {
                    print("缓存图片URL: \(url)")
                    ImageUrlCache.set(partNum: partNum, colorId: colorId, url: url)
                } else {
                    print("无图片URL可缓存")
                }
                print("完成获取图片URL，返回: \(fetchedUrl ?? "nil")")
                completion(fetchedUrl)
            }
        }
    }
    
    private func loadCachedImage() -> UIImage? {
        // 生成缓存文件名
        let cacheFileName = "\(partNum)_\(colorId).jpg"
        
        // 获取缓存目录
        guard let cacheDirectory = getCacheDirectory() else {
            print("无法获取缓存目录")
            return nil
        }
        
        // 构建缓存文件路径
        let cacheFileURL = cacheDirectory.appendingPathComponent(cacheFileName)
        
        // 检查文件是否存在
        if FileManager.default.fileExists(atPath: cacheFileURL.path) {
            print("找到缓存图片: \(cacheFileURL.path)")
            if let data = try? Data(contentsOf: cacheFileURL), let image = UIImage(data: data) {
                print("缓存图片加载成功")
                return image
            } else {
                print("缓存图片数据无效，删除损坏的缓存文件")
                try? FileManager.default.removeItem(at: cacheFileURL)
                return nil
            }
        }
        
        print("缓存中无图片: \(cacheFileName)")
        return nil
    }
    
    private func saveImageToCache(image: UIImage) {
        // 生成缓存文件名
        let cacheFileName = "\(partNum)_\(colorId).jpg"
        
        // 获取缓存目录
        guard let cacheDirectory = getCacheDirectory() else {
            print("无法获取缓存目录")
            return
        }
        
        // 构建缓存文件路径
        let cacheFileURL = cacheDirectory.appendingPathComponent(cacheFileName)
        
        // 将图片转换为JPEG数据并保存
        if let jpegData = image.jpegData(compressionQuality: 0.8) {
            do {
                try jpegData.write(to: cacheFileURL)
                print("图片保存到缓存成功: \(cacheFileURL.path)")
            } catch {
                print("保存图片到缓存失败: \(error)")
            }
        } else {
            print("无法将图片转换为JPEG数据")
        }
    }
    
    private func getCacheDirectory() -> URL? {
        // 获取应用的文档目录
        let documentDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        
        // 创建images_cache子目录
        if let documentDirectory = documentDirectory {
            let cacheDirectory = documentDirectory.appendingPathComponent("images_cache")
            
            // 确保目录存在
            do {
                try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true, attributes: nil)
                return cacheDirectory
            } catch {
                print("创建缓存目录失败: \(error)")
                return nil
            }
        }
        
        return nil
    }
}